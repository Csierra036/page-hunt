// Mode C: visual simulation. A screenshot of the page (taken by the local server
// without cookies) is cut into pieces at the positions of its text, images,
// controls and painted boxes. Everything here is a picture of the page: the real
// site is never modified, and the HUD says so.
import type { Capture, CaptureBlock } from '../../server/capture';
import { crackPaths, damageStage, distToRect, EdgeBites, falloff, gridShatter, hpForArea, hpForImage, jaggedRect } from '../core/damage';
import { pixelCracks, pixelHole, stairPath } from '../fx/pixel';
import { drawVoid, emptyHit, mergeHits, type HitResult, type Stage, type StageHost } from './types';

interface Piece {
  box: boolean;
  cat: CaptureBlock['cat'];
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  max: number;
  weight: number;
  stage: number;
  alive: boolean;
  /** Own texture (content pieces); boxes are painted in the background image. */
  tex: HTMLCanvasElement | null;
  /** Whole-pixel displacement once badly damaged (pixel art does not skew or rotate). */
  dx: number;
  dy: number;
  wobble: number;
  bites: EdgeBites | null;
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la captura.'));
    img.src = src;
  });
}

export class CaptureStage implements Stage {
  readonly mode = 'capture' as const;
  readonly label = 'SIMULACIÓN VISUAL';
  readonly detail = 'Imagen de la página capturada por el servidor local (sin cookies ni sesión). Lo que se rompe es la captura: la página real no se modifica.';
  readonly scrollable = true;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private host!: StageHost;
  /** Background with content hidden; holes are punched into it. */
  private bg!: HTMLCanvasElement;
  private bgCtx!: CanvasRenderingContext2D;
  /** CPU copy of the screenshot used only to sample colours (keeps the drawn canvases on the GPU). */
  private reader!: CanvasRenderingContext2D;
  private pieces: Piece[] = [];
  private boxes: Piece[] = [];
  private content: Piece[] = [];
  private total = 0;
  private dealt = 0;
  private s = 1;
  private scrollY = 0;
  /** Where smooth scrolling is heading. */
  private scrollTarget = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private collapseQueue: Piece[] | null = null;

  constructor(private cap: Capture, private full: HTMLImageElement, private bgImg: HTMLImageElement) {}

  async mount(layer: HTMLElement, host: StageHost) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'page-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    layer.append(this.canvas);
    this.build();
  }

  private build() {
    const { width, height } = this.cap;
    this.bg = document.createElement('canvas');
    this.bg.width = width;
    this.bg.height = height;
    this.bgCtx = this.bg.getContext('2d')!;
    this.bgCtx.drawImage(this.bgImg, 0, 0);
    const reader = document.createElement('canvas');
    reader.width = width;
    reader.height = height;
    this.reader = reader.getContext('2d', { willReadFrequently: true })!;
    this.reader.drawImage(this.full, 0, 0);
    const pieceOf = (b: CaptureBlock): Piece => {
      const box = b.cat === 'box';
      let tex: HTMLCanvasElement | null = null;
      if (!box) {
        tex = document.createElement('canvas');
        tex.width = Math.max(1, Math.ceil(b.w));
        tex.height = Math.max(1, Math.ceil(b.h));
        tex.getContext('2d')!.drawImage(this.full, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      }
      // Images and painted boxes (often background pictures) scale their toughness with size.
      const hp = box ? Math.min(120, hpForImage(b.w, b.h) + 4) : b.cat === 'media' ? hpForImage(b.w, b.h) : hpForArea(b.w, b.h);
      return { box, cat: b.cat, x: b.x, y: b.y, w: b.w, h: b.h, hp, max: hp, weight: Math.sqrt(b.w * b.h) * (box ? 0.6 : 1), stage: 0, alive: true, tex, dx: 0, dy: 0, wobble: 0, bites: null };
    };
    // Boxes the size of a whole section are page background, not a breakable piece:
    // one of them breaking would empty the screen at once.
    const sectionArea = width * 800 * 0.35;
    this.pieces = this.cap.blocks.filter((b) => b.cat !== 'box' || b.w * b.h <= sectionArea).map(pieceOf);
    this.boxes = this.pieces.filter((p) => p.box);
    this.content = this.pieces.filter((p) => !p.box);
    this.total = this.pieces.reduce((s, p) => s + p.weight, 0);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.s = w / this.cap.width;
    this.scroll(0);
    this.scrollY = this.scrollTarget;
  }

  /** Stage px -> page px. */
  private toPage(x: number, y: number): [number, number] {
    return [x / this.s, y / this.s + this.scrollY];
  }

  private toStage(px: number, py: number): [number, number] {
    return [px * this.s, (py - this.scrollY) * this.s];
  }

  private pieceAt(px: number, py: number): Piece | null {
    for (let i = this.content.length - 1; i >= 0; i--) {
      const p = this.content[i];
      if (p.alive && px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) return p;
    }
    let best: Piece | null = null;
    for (const p of this.boxes) {
      if (p.alive && px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h && (!best || p.w * p.h < best.w * best.h)) best = p;
    }
    return best;
  }

  private colorAt(px: number, py: number) {
    const d = this.reader.getImageData(Math.max(0, Math.min(this.cap.width - 1, px | 0)), Math.max(0, Math.min(this.cap.height - 1, py | 0)), 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  }

  hit(x: number, y: number, damage: number): HitResult {
    const [px, py] = this.toPage(x, y);
    if (py < 0 || py > this.cap.height) return emptyHit();
    const p = this.pieceAt(px, py);
    if (!p) {
      // Bare page background: it only gets marked.
      const color = this.colorAt(px, py);
      pixelHole(this.bgCtx, px, py, 4);
      if (Math.random() < 0.3) pixelCracks(this.bgCtx, crackPaths(24), px, py);
      return { ...emptyHit(), kind: 'surface', color };
    }
    if (p.tex) {
      pixelHole(p.tex.getContext('2d')!, px - p.x, py - p.y, 4);
    } else {
      pixelHole(this.bgCtx, px, py, 4);
    }
    return this.damage(p, damage, px, py, false);
  }

  private damage(p: Piece, amount: number, px: number, py: number, blast: boolean): HitResult {
    if (!p.alive) return emptyHit();
    const before = p.hp;
    p.hp = Math.max(0, p.hp - amount);
    const dealt = before - p.hp;
    this.dealt += (p.weight * dealt) / p.max;
    const color = this.colorAt(px, py);
    p.wobble = Math.min(1, p.wobble + (blast ? 0.8 : 0.4));
    const stage = damageStage(p.hp, p.max);
    if (stage !== p.stage && stage < 4) {
      p.stage = stage;
      const scale = Math.max(12, Math.min(120, Math.min(p.w, p.h) * 0.8));
      if (p.tex) {
        const tctx = p.tex.getContext('2d')!;
        if (stage >= 2) pixelCracks(tctx, crackPaths(scale), px - p.x, py - p.y);
        // Scorched paint on images and controls. Text pieces include the page background
        // around the letters, so tinting them would leave visible rectangles.
        if (p.cat === 'media' || p.cat === 'control') {
          tctx.globalCompositeOperation = 'source-atop';
          tctx.fillStyle = stage >= 3 ? 'rgba(120,40,10,0.28)' : 'rgba(90,60,30,0.14)';
          tctx.fillRect(0, 0, p.w, p.h);
          tctx.globalCompositeOperation = 'source-over';
        }
        // Knocked out of place by whole pixels.
        const k = stage >= 3 ? 3 : 1;
        p.dx = Math.round((Math.random() - 0.5) * 2 * k) * 2;
        p.dy = Math.round(Math.random() * k) * 2;
      } else if (stage >= 2) {
        this.bgCtx.save();
        this.bgCtx.beginPath();
        this.bgCtx.rect(p.x, p.y, p.w, p.h);
        this.bgCtx.clip();
        pixelCracks(this.bgCtx, crackPaths(scale), px, py);
        this.bgCtx.fillStyle = stage >= 3 ? 'rgba(70,30,10,0.18)' : 'rgba(50,40,30,0.1)';
        this.bgCtx.fillRect(p.x, p.y, p.w, p.h);
        this.bgCtx.restore();
      }
    }
    // From cracked on, every hit chips a staircase off the nearest edge.
    if (p.tex && p.stage >= 2 && p.hp > 0 && p.w >= 10 && p.h >= 8) {
      p.bites ??= new EdgeBites(p.w, p.h);
      p.bites.bite(px - p.x, py - p.y, p.stage >= 3 ? 3 : 2);
      const tctx = p.tex.getContext('2d')!;
      for (const c of p.bites.removed()) tctx.clearRect(c.x, c.y, c.w, c.h);
      this.host.particles.chips(...this.toStage(px, py), color, 4);
    }
    if (p.hp > 0) return { kind: 'element', damage: dealt, broke: 0, breakPoints: 0, color };
    const b = this.breakPiece(p, px, py, blast);
    return { kind: 'element', damage: dealt, broke: b.count, breakPoints: b.points, color };
  }

  private kill(p: Piece) {
    if (!p.alive) return false;
    this.dealt += (p.weight * p.hp) / p.max;
    p.hp = 0;
    p.alive = false;
    return true;
  }

  private breakPiece(p: Piece, px: number, py: number, loose: boolean) {
    let count = 0;
    let points = 0;
    if (this.kill(p)) {
      count++;
      points += Math.round(p.weight / 2);
    }
    const [sx, sy] = this.toStage(p.x, p.y);
    const [hx, hy] = this.toStage(px, py);
    const particles = this.host.particles;
    if (p.tex) {
      // Blocks of about 44 px whatever the piece size, so everything crumbles at the same pixel scale.
      const polys = gridShatter(p.w * this.s, p.h * this.s, Math.max(loose ? 2 : 4, Math.min(40, Math.round((p.w * p.h) / 44 ** 2))));
      particles.shatterRect(sx, sy, polys, '#888', { image: p.tex, ox: 0, oy: 0, scale: 1 / this.s }, loose ? 0.6 : 1, hx, hy);
    } else {
      // A box: cut its look out of the background, then punch a hole in the page.
      const piece = document.createElement('canvas');
      piece.width = Math.ceil(p.w);
      piece.height = Math.ceil(p.h);
      piece.getContext('2d')!.drawImage(this.bg, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h);
      const n = Math.max(6, Math.min(40, Math.round((p.w * p.h) / 48 ** 2)));
      particles.shatterRect(sx, sy, gridShatter(p.w * this.s, p.h * this.s, n), '#888', { image: piece, ox: 0, oy: 0, scale: 1 / this.s }, 1, hx, hy);
      const ctx = this.bgCtx;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      stairPath(ctx, jaggedRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4), 8);
      ctx.fill();
      ctx.restore();
      // Content sitting on the box loses its support and falls.
      for (const c of this.content) {
        if (c.alive && c.x >= p.x - 2 && c.y >= p.y - 2 && c.x + c.w <= p.x + p.w + 2 && c.y + c.h <= p.y + p.h + 2) {
          const r = this.breakPiece(c, c.x + c.w / 2, c.y + c.h / 2, true);
          count += r.count;
          points += Math.round(r.points / 2);
        }
      }
    }
    particles.dust(hx, hy, 5, 'rgba(200,190,170,0.45)', Math.min(p.w, p.h) * this.s * 0.3);
    return { count, points };
  }

  blast(x: number, y: number, radius: number, power: number): HitResult {
    const [px, py] = this.toPage(x, y);
    const r = radius / this.s;
    let res = emptyHit();
    for (const p of this.pieces) {
      if (!p.alive || p.y > py + r || p.y + p.h < py - r) continue;
      const f = falloff(distToRect(px, py, p.x, p.y, p.w, p.h), r);
      if (f < 0.05) continue;
      const amount = p.stage >= 3 && f > 0.3 && p.hp <= 6 ? p.hp : power * f * (p.box ? 0.7 : 1);
      res = mergeHits(res, this.damage(p, amount, p.x + p.w / 2, p.y + p.h / 2, true));
    }
    return res;
  }

  private get maxScroll() {
    return Math.max(0, this.cap.height - this.h / this.s);
  }

  scroll(dy: number) {
    this.scrollTarget = Math.max(0, Math.min(this.maxScroll, this.scrollTarget + dy / this.s));
  }

  update(dt: number) {
    if (this.collapseQueue) {
      const n = Math.ceil(this.collapseQueue.length * dt * 1.4) + 1;
      for (const p of this.collapseQueue.splice(0, n)) {
        if (p.alive) this.breakPiece(p, p.x + p.w / 2, p.y + p.h / 2, Math.random() < 0.5);
      }
      if (!this.collapseQueue.length) this.collapseQueue = null;
    }
    for (const p of this.pieces) p.wobble = Math.max(0, p.wobble - dt * 3);
    // Smooth scrolling, landing on whole pixels.
    this.scrollTarget = Math.min(this.scrollTarget, this.maxScroll);
    const d = this.scrollTarget - this.scrollY;
    this.scrollY = Math.abs(d) < 0.5 ? this.scrollTarget : this.scrollY + d * Math.min(1, dt * 14);
    this.draw();
  }

  private draw() {
    const { ctx, s } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawVoid(ctx, this.w, this.h, this.scrollY * s);
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(0, -this.scrollY);
    const top = this.scrollY;
    const bottom = top + this.h / s;
    // Crisp pixels when enlarging; smoothing only helps when the capture is shrunk.
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(this.bg, 0, top, this.cap.width, bottom - top, 0, top, this.cap.width, bottom - top);
    const t = performance.now() / 1000;
    for (const p of this.content) {
      if (!p.alive || p.y > bottom || p.y + p.h < top) continue;
      // Hit pieces jitter by whole pixels instead of wobbling smoothly.
      const j = p.wobble > 0.05 ? (Math.sin(t * 50 + p.x) > 0 ? 2 : -2) * Math.ceil(p.wobble * 2) : 0;
      ctx.drawImage(p.tex!, p.x + p.dx + j, p.y + p.dy);
    }
    ctx.restore();
    // Scroll indicator.
    const viewH = this.h / s;
    if (this.cap.height > viewH + 1) {
      const barH = Math.max(30, (viewH / this.cap.height) * this.h);
      const y = (this.scrollY / (this.cap.height - viewH)) * (this.h - barH);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(this.w - 6, y, 4, barH);
    }
  }

  destruction() {
    return this.total ? Math.min(1, this.dealt / this.total) : 0;
  }

  collapse() {
    this.collapseQueue = this.pieces.filter((p) => p.alive).sort((a, b) => b.y + b.h - (a.y + a.h));
  }

  dispose() {
    this.canvas?.remove();
  }
}
