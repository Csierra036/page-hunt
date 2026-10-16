// Common contract of the three ways a page can be the level.
// All coordinates are stage-local CSS px (the area under the HUD).
import type { Particles } from '../fx/particles';

export type StageMode = 'dom' | 'iframe' | 'capture';

export interface HitResult {
  /** element: damaged something breakable; surface: only marked the page; none: nothing left to hit. */
  kind: 'element' | 'surface' | 'none';
  damage: number;
  broke: number;
  /** Base points of what broke. */
  breakPoints: number;
  /** Colour for chips/sparks at the impact. */
  color: string;
}

export const emptyHit = (): HitResult => ({ kind: 'none', damage: 0, broke: 0, breakPoints: 0, color: '#999' });

export function mergeHits(a: HitResult, b: HitResult): HitResult {
  const rank = { none: 0, surface: 1, element: 2 };
  return {
    kind: rank[b.kind] > rank[a.kind] ? b.kind : a.kind,
    damage: a.damage + b.damage,
    broke: a.broke + b.broke,
    breakPoints: a.breakPoints + b.breakPoints,
    color: b.kind === 'element' ? b.color : a.color,
  };
}

export interface StageHost {
  particles: Particles;
}

export interface Stage {
  readonly mode: StageMode;
  /** Short honest label shown in the HUD. */
  readonly label: string;
  readonly detail: string;
  /** Whether wheel scrolling moves the page. */
  readonly scrollable: boolean;
  mount(layer: HTMLElement, host: StageHost): Promise<void>;
  resize(w: number, h: number): void;
  hit(x: number, y: number, damage: number): HitResult;
  blast(x: number, y: number, radius: number, power: number): HitResult;
  scroll(dy: number): void;
  update(dt: number): void;
  /** 0..1 */
  destruction(): number;
  /** Final collapse once the goal is reached. */
  collapse(): void;
  dispose(): void;
}

// ---------- Shared drawing helpers ----------

/** Void seen through holes in the page. */
export function drawVoid(ctx: CanvasRenderingContext2D, w: number, h: number, offsetY = 0) {
  ctx.fillStyle = '#07070d';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(90,110,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = 32;
  for (let x = 0; x < w; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = -(offsetY % step); y < h; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
}

export function readableColor(c: string | null | undefined, fallback = '#9aa0a6') {
  if (!c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c)) return fallback;
  return c;
}
