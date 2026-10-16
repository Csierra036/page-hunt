// Damage model shared by every stage: hit points per size, visual stages, blast falloff, crack shapes.

export type Pt = [number, number];
export type Poly = Pt[];

/** Bigger elements take more hits: ~sqrt(area). */
export function hpForArea(w: number, h: number) {
  return Math.max(2, Math.min(24, Math.round(Math.sqrt(Math.max(0, w * h)) / 14)));
}

/**
 * Images and painted backgrounds: like any element when small, but big ones (hero
 * pictures, banners) keep gaining hit points well past the normal cap.
 */
export function hpForImage(w: number, h: number) {
  const side = Math.sqrt(Math.max(0, w * h));
  return Math.min(120, hpForArea(w, h) + Math.round(Math.max(0, side - 150) / 5));
}

/** 0 intact, 1 scratched, 2 cracked and tinted, 3 deformed and about to break, 4 broken. */
export function damageStage(hp: number, maxHp: number) {
  if (hp <= 0) return 4;
  const r = hp / maxHp;
  if (r > 0.8) return r >= 1 ? 0 : 1;
  if (r > 0.45) return 2;
  return 3;
}

/** Shockwave falloff: 1 at the centre, 0 at the radius. */
export function falloff(dist: number, radius: number) {
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  return t * t * (3 - 2 * t);
}

/** Distance from a point to a rectangle (0 inside). */
export function distToRect(px: number, py: number, x: number, y: number, w: number, h: number) {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  return Math.hypot(dx, dy);
}

/** Jagged crack polylines radiating from (0,0), sized to `scale` px. */
export function crackPaths(scale: number, rand = Math.random, branches = 3 + Math.floor(rand() * 3)): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i < branches; i++) {
    let a = (i / branches) * Math.PI * 2 + rand() * 0.9;
    let x = 0;
    let y = 0;
    const pts: Poly = [[0, 0]];
    const steps = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 0.9;
      const len = (scale / steps) * (0.6 + rand() * 0.8);
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
      if (rand() < 0.25 && s < steps - 1) {
        const b = a + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5);
        out.push([[x, y], [x + Math.cos(b) * len * 0.7, y + Math.sin(b) * len * 0.7]]);
      }
    }
    out.push(pts);
  }
  return out;
}

/**
 * Splits a w x h rectangle into triangle-fan shards around (cx, cy), in local coordinates.
 * Used to fragment an element from the impact point.
 */
export function shatter(w: number, h: number, cx: number, cy: number, count: number, rand = Math.random): Poly[] {
  const rim: Pt[] = [];
  const per = Math.max(1, Math.round(count / 4));
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < per; i++) {
      const t = (i + (i ? rand() * 0.6 : 0)) / per;
      rim.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  };
  edge(0, 0, w, 0);
  edge(w, 0, w, h);
  edge(w, h, 0, h);
  edge(0, h, 0, 0);
  const c: Pt = [Math.max(0, Math.min(w, cx)), Math.max(0, Math.min(h, cy))];
  return rim.map((p, i) => [c, p, rim[(i + 1) % rim.length]]);
}

/** Jagged outline slightly inside a rectangle, for holes punched in a surface. */
export function jaggedRect(x: number, y: number, w: number, h: number, rand = Math.random): Poly {
  const pts: Poly = [];
  const j = Math.min(w, h) * 0.12;
  const n = (len: number) => Math.max(2, Math.round(len / 18));
  const side = (x0: number, y0: number, x1: number, y1: number) => {
    const k = n(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i < k; i++) {
      const t = i / k;
      pts.push([x0 + (x1 - x0) * t + (rand() - 0.5) * j, y0 + (y1 - y0) * t + (rand() - 0.5) * j]);
    }
  };
  side(x, y, x + w, y);
  side(x + w, y, x + w, y + h);
  side(x + w, y + h, x, y + h);
  side(x, y + h, x, y);
  return pts;
}

/** Splits a w x h rectangle into about `pieces` square-ish blocks (pixel shards), in local coordinates. */
export function gridShatter(w: number, h: number, pieces: number): Poly[] {
  const cell = Math.max(3, Math.sqrt((w * h) / Math.max(1, pieces)));
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  const cw = w / cols;
  const ch = h / rows;
  const out: Poly[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw;
      const y = r * ch;
      out.push([[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]]);
    }
  }
  return out;
}

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pixel chips bitten from the edges of a rectangle. Each edge keeps a depth (in cells)
 * per column/row, so the remaining shape is a staircase outline that CSS clip-path or
 * canvas erasing can reproduce.
 */
export class EdgeBites {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly top: number[];
  readonly bottom: number[];
  readonly left: number[];
  readonly right: number[];

  constructor(readonly w: number, readonly h: number, cell?: number) {
    this.cell = cell ?? Math.max(3, Math.min(8, Math.floor(Math.min(w, h) / 5)));
    this.cols = Math.max(1, Math.ceil(w / this.cell));
    this.rows = Math.max(1, Math.ceil(h / this.cell));
    this.top = new Array(this.cols).fill(0);
    this.bottom = new Array(this.cols).fill(0);
    this.left = new Array(this.rows).fill(0);
    this.right = new Array(this.rows).fill(0);
  }

  /** Bites the edge nearest to (hx, hy), `depth` cells deep at the centre, stepping down to the sides. */
  bite(hx: number, hy: number, depth: number, rand = Math.random) {
    const dists = [hy, this.h - hy, hx, this.w - hx];
    const edge = dists.indexOf(Math.min(...dists));
    const horizontal = edge < 2;
    const arr = [this.top, this.bottom, this.left, this.right][edge];
    const max = Math.max(0, Math.floor((horizontal ? this.rows : this.cols) * 0.4));
    const center = Math.max(0, Math.min(arr.length - 1, Math.floor((horizontal ? hx : hy) / this.cell)));
    for (let k = -depth; k <= depth; k++) {
      const i = center + k;
      if (i < 0 || i >= arr.length) continue;
      const d = Math.min(max, depth - Math.abs(k) + (rand() < 0.4 ? 1 : 0));
      if (d > arr[i]) arr[i] = d;
    }
  }

  /** The remaining shape, clockwise from the top-left corner. */
  polygon(): Poly {
    const { cell: c, w, h } = this;
    const pts: Poly = [];
    for (let i = 0; i < this.cols; i++) pts.push([i * c, this.top[i] * c], [Math.min(w, (i + 1) * c), this.top[i] * c]);
    for (let i = 0; i < this.rows; i++) pts.push([w - this.right[i] * c, i * c], [w - this.right[i] * c, Math.min(h, (i + 1) * c)]);
    for (let i = this.cols - 1; i >= 0; i--) pts.push([Math.min(w, (i + 1) * c), h - this.bottom[i] * c], [i * c, h - this.bottom[i] * c]);
    for (let i = this.rows - 1; i >= 0; i--) pts.push([this.left[i] * c, Math.min(h, (i + 1) * c)], [this.left[i] * c, i * c]);
    return pts;
  }

  /** Every bitten-off cell, for erasing them from a texture. */
  removed(): Cell[] {
    const { cell: c, w, h } = this;
    const out: Cell[] = [];
    this.top.forEach((d, i) => d && out.push({ x: i * c, y: 0, w: c, h: d * c }));
    this.bottom.forEach((d, i) => d && out.push({ x: i * c, y: h - d * c, w: c, h: d * c }));
    this.left.forEach((d, i) => d && out.push({ x: 0, y: i * c, w: d * c, h: c }));
    this.right.forEach((d, i) => d && out.push({ x: w - d * c, y: i * c, w: d * c, h: c }));
    return out;
  }

  get bitten() {
    return [this.top, this.bottom, this.left, this.right].some((a) => a.some((d) => d > 0));
  }
}
