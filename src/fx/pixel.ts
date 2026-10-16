// Pixel-art drawing helpers: damage, rings and the reticle snap to a grid of blocks
// instead of smooth vector strokes.
import type { Poly } from '../core/damage';

export const PX = 3;

const snap = (v: number, s: number) => Math.floor(v / s) * s;

export function block(ctx: CanvasRenderingContext2D, x: number, y: number, s = PX) {
  ctx.fillRect(snap(x, s), snap(y, s), s, s);
}

export function pixelLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, s = PX) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / s));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    block(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, s);
  }
}

/** Cracks made of blocks: a light edge under a dark line. */
export function pixelCracks(ctx: CanvasRenderingContext2D, polys: Poly[], x: number, y: number, s = PX) {
  for (const [color, off] of [['rgba(255,255,255,0.45)', s], ['#140d08', 0]] as const) {
    ctx.fillStyle = color;
    for (const poly of polys) {
      for (let i = 1; i < poly.length; i++) {
        pixelLine(ctx, x + poly[i - 1][0] + off, y + poly[i - 1][1] + off, x + poly[i][0] + off, y + poly[i][1] + off, s);
      }
    }
  }
}

/** Blocky bullet hole: dark core, soot blocks around it and a light rim on one side. */
export function pixelHole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s = PX) {
  const cx = snap(x, s) + s / 2;
  const cy = snap(y, s) + s / 2;
  const R = Math.ceil(r / s) + 2;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const d = Math.hypot(i, j) * s;
      if (d <= r) ctx.fillStyle = '#0d0a08';
      else if (d <= r + s * 1.6 && Math.random() < 0.65) ctx.fillStyle = i + j > 0 ? 'rgba(255,255,255,0.35)' : 'rgba(30,20,12,0.6)';
      else continue;
      ctx.fillRect(cx + i * s - s / 2, cy + j * s - s / 2, s, s);
    }
  }
}

/** Ring of blocks (impact rings, spread circle). */
export function pixelRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s = PX) {
  const n = Math.max(12, Math.round((Math.PI * 2 * r) / (s * 1.3)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    block(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, s);
  }
}

/** Arc of blocks from angle a0 to a1 (radians). */
export function pixelArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, s = PX) {
  const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / (s * 1.1)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    block(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, s);
  }
}

/** Traces a polygon as an orthogonal staircase on the grid (for holes punched in a surface). */
export function stairPath(ctx: CanvasRenderingContext2D, poly: Poly, s: number) {
  ctx.beginPath();
  const pts = poly.map(([px, py]) => [snap(px, s), snap(py, s)] as const);
  pts.forEach(([px, py], i) => {
    if (i === 0) return ctx.moveTo(px, py);
    ctx.lineTo(px, pts[i - 1][1]);
    ctx.lineTo(px, py);
  });
  ctx.lineTo(pts[0][0], pts[pts.length - 1][1]);
  ctx.closePath();
}
