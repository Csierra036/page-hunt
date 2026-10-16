// Mode A: an external page whose headers allow embedding. It is shown live in a
// sandboxed iframe (no scripts, no cookies, no referrer), but its DOM belongs to
// another origin and is NOT accessible: damage lives in an overlay layer split
// into cells that crack, darken and finally tear holes in the view.
import { crackPaths, damageStage, distToRect, falloff, gridShatter, jaggedRect } from '../core/damage';
import { pixelCracks, pixelHole, stairPath } from '../fx/pixel';
import { emptyHit, mergeHits, type HitResult, type Stage, type StageHost } from './types';

const CELL = 96;
const CELL_HP = 7;

interface Cell {
  hp: number;
  stage: number;
}

export class IframeStage implements Stage {
  readonly mode = 'iframe' as const;
  readonly label = 'IFRAME · CAPA DE DAÑO';
  readonly detail = 'Página externa mostrada en vivo. Su DOM es de otro origen y no es accesible: los daños se dibujan en una capa superpuesta y la página no se puede desplazar. Para desplazarte, usa la simulación visual.';
  readonly scrollable = false;

  private iframe!: HTMLIFrameElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private host!: StageHost;
  private cells: Cell[] = [];
  private cols = 0;
  private rows = 0;
  /** Logical size the damage was drawn at; later resizes stretch it. */
  private baseW = 0;
  private baseH = 0;
  private w = 0;
  private h = 0;
  private dealt = 0;
  private collapseOrder: number[] | null = null;

  constructor(private url: string) {}

  async mount(layer: HTMLElement, host: StageHost) {
    this.host = host;
    const iframe = document.createElement('iframe');
    iframe.className = 'page-frame';
    // Empty sandbox = no scripts, forms, popups or navigation; opaque origin.
    iframe.setAttribute('sandbox', '');
    iframe.setAttribute('credentialless', '');
    iframe.referrerPolicy = 'no-referrer';
    iframe.allow = '';
    iframe.title = 'Escenario: página externa (solo visual)';
    iframe.src = this.url;
    this.iframe = iframe;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'page-overlay';
    this.ctx = this.canvas.getContext('2d')!;
    layer.append(iframe, this.canvas);
    // A cross-origin frame does not report errors; "load" also fires for error pages.
    // The probe already checked the headers, so a timeout only means a slow site.
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, 12_000);
      iframe.addEventListener('load', () => (clearTimeout(t), resolve()), { once: true });
    });
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    if (!this.baseW) {
      this.baseW = w;
      this.baseH = h;
      this.cols = Math.ceil(w / CELL);
      this.rows = Math.ceil(h / CELL);
      this.cells = Array.from({ length: this.cols * this.rows }, () => ({ hp: CELL_HP, stage: 0 }));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** Stage point -> logical (damage canvas) point. */
  private toBase(x: number, y: number): [number, number] {
    return [(x / this.w) * this.baseW, (y / this.h) * this.baseH];
  }

  private cellAt(bx: number, by: number) {
    const c = Math.floor(bx / CELL);
    const r = Math.floor(by / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  hit(x: number, y: number, damage: number): HitResult {
    const [bx, by] = this.toBase(x, y);
    const i = this.cellAt(bx, by);
    if (i < 0 || this.cells[i].hp <= 0) return emptyHit();
    pixelHole(this.ctx, bx, by, 4);
    return this.damageCell(i, damage, bx, by);
  }

  private damageCell(i: number, amount: number, bx: number, by: number): HitResult {
    const cell = this.cells[i];
    if (cell.hp <= 0) return emptyHit();
    const before = cell.hp;
    cell.hp = Math.max(0, cell.hp - amount);
    this.dealt += before - cell.hp;
    const cx = (i % this.cols) * CELL;
    const cy = Math.floor(i / this.cols) * CELL;
    const stage = damageStage(cell.hp, CELL_HP);
    const ctx = this.ctx;
    if (stage !== cell.stage && stage < 4) {
      cell.stage = stage;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - 30, cy - 30, CELL + 60, CELL + 60);
      ctx.clip();
      if (stage >= 2) pixelCracks(ctx, crackPaths(CELL * 0.6), bx, by);
      ctx.fillStyle = stage >= 3 ? 'rgba(60,25,10,0.22)' : 'rgba(40,30,20,0.12)';
      ctx.fillRect(cx, cy, CELL, CELL);
      ctx.restore();
    }
    if (cell.hp > 0) return { kind: 'element', damage: before - cell.hp, broke: 0, breakPoints: 0, color: '#c9ccd2' };

    // Tear a blocky hole in the view.
    ctx.save();
    stairPath(ctx, jaggedRect(cx - 4, cy - 4, CELL + 8, CELL + 8), 8);
    ctx.fillStyle = '#07070d';
    ctx.fill();
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    const kx = this.w / this.baseW;
    const ky = this.h / this.baseH;
    this.host.particles.shatterRect(cx * kx, cy * ky, gridShatter(CELL * kx, CELL * ky, 9), 'rgba(225,228,235,0.85)', null, 1, bx * kx, by * ky);
    this.host.particles.dust((cx + CELL / 2) * kx, (cy + CELL / 2) * ky, 6);
    return { kind: 'element', damage: before - cell.hp, broke: 1, breakPoints: 20, color: '#c9ccd2' };
  }

  blast(x: number, y: number, radius: number, power: number): HitResult {
    const [bx, by] = this.toBase(x, y);
    let res = emptyHit();
    this.cells.forEach((cell, i) => {
      if (cell.hp <= 0) return;
      const cx = (i % this.cols) * CELL;
      const cy = Math.floor(i / this.cols) * CELL;
      const f = falloff(distToRect(bx, by, cx, cy, CELL, CELL), radius);
      if (f < 0.05) return;
      const amount = cell.stage >= 3 && f > 0.3 ? cell.hp : power * f;
      res = mergeHits(res, this.damageCell(i, amount, cx + CELL / 2, cy + CELL / 2));
    });
    return res;
  }

  scroll() {
    // The damage layer is pinned to the viewport and the frame is cross-origin: scrolling is locked.
  }

  update(dt: number) {
    if (this.collapseOrder?.length) {
      const n = Math.ceil(this.cells.length * dt * 0.9);
      for (const i of this.collapseOrder.splice(0, n)) {
        const cx = (i % this.cols) * CELL;
        const cy = Math.floor(i / this.cols) * CELL;
        this.damageCell(i, CELL_HP, cx + CELL / 2, cy + CELL / 2);
      }
    }
    // Stretch the damage layer if the stage was resized.
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  destruction() {
    return this.cells.length ? this.dealt / (this.cells.length * CELL_HP) : 0;
  }

  collapse() {
    this.collapseOrder = this.cells.map((_, i) => i).filter((i) => this.cells[i].hp > 0).sort((a, b) => b - a);
  }

  dispose() {
    this.iframe?.remove();
    this.canvas?.remove();
  }
}
