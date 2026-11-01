// "Doom": a screen-wide ultimate charged by dealing damage, not a dropped weapon. On
// activation it freezes the action for a beat, shows a manga-panel reveal of the caster
// (Alan Becker / Skullgirls "super flash" style, diagonal panel like an action manga splash)
// and then unleashes a wormhole, anchored where the cursor was aiming, that wipes every duck
// on screen, blasts the page hard and hits the boss for a flat, non-lethal chunk of its max
// health. Everything (rings, panel border, even the portrait) is pixelated to match the
// game's blocky art: the portrait is downsampled to a small offscreen canvas once, then drawn
// back up with smoothing off, the same trick that gives retro games their chunky look.
import doomArtUrl from '../assets/img/doom-reveal.png?url';
import type { Poly } from '../core/damage';
import { block, pixelLine, pixelRing } from './pixel';

export const DOOM_MAX_CHARGE = 100;

/** Flat damage given to the page: tuned so most elements shatter and big images take a real dent. */
export const DOOM_PAGE_POWER = 60;
/** Share of a boss's *max* health the blast removes. Capped below its current health so it never finishes it off. */
export const DOOM_BOSS_FRACTION = 0.22;

/** Radius big enough that the shockwave falloff (see core/damage.ts) stays strong at every screen corner. */
export const doomRadius = (w: number, h: number) => Math.hypot(w, h) * 4;

/** Fills from damage dealt; ready at `DOOM_MAX_CHARGE`. The UI reads `pct`/`ready`. */
export class DoomMeter {
  charge = 0;

  add(amount: number) {
    if (amount > 0) this.charge = Math.min(DOOM_MAX_CHARGE, this.charge + amount);
  }

  get pct() {
    return this.charge / DOOM_MAX_CHARGE;
  }

  get ready() {
    return this.charge >= DOOM_MAX_CHARGE;
  }

  /** Spends the full meter. False (and unchanged) if it was not ready. */
  consume() {
    if (!this.ready) return false;
    this.charge = 0;
    return true;
  }

  reset() {
    this.charge = 0;
  }
}

type Phase = 'reveal' | 'unleash' | 'fade';

const REVEAL_T = 1.05;
const UNLEASH_T = 0.7;
const FADE_T = 0.5;
/** How chunky the pixelated portrait is: its width in "big pixels" before scaling back up. */
const PORTRAIT_BLOCKS = 42;

/**
 * The activation cutscene. `start()` freezes gameplay (the caller stops updating ducks/boss
 * while `active` is true); `onImpact` fires once, right as the reveal panel snaps shut and
 * the vortex starts expanding at `(ox, oy)`, which is when the caller should apply the actual
 * damage (the blast radius always covers the whole screen; only where it visually opens from
 * follows the cursor).
 */
export class DoomSequence {
  phase: Phase | null = null;
  private t = 0;
  private onImpact: (() => void) | null = null;
  private img = new Image();
  private portrait: HTMLCanvasElement | null = null;
  /** Per-run so the rings don't all spin in lockstep. */
  private seed = 0;
  private ox = 0;
  private oy = 0;
  /** Torn-edge panel outline, rebuilt once per activation once its size is known. */
  private jagged: Poly | null = null;

  constructor() {
    this.img.onload = () => this.buildPortrait();
    this.img.src = doomArtUrl;
  }

  get active() {
    return this.phase !== null;
  }

  /** `ox`/`oy`: where the wormhole opens (the cursor position at the moment of activation). */
  start(onImpact: () => void, ox: number, oy: number) {
    if (this.active) return;
    this.phase = 'reveal';
    this.t = 0;
    this.seed = Math.random() * 100;
    this.jagged = null;
    this.ox = ox;
    this.oy = oy;
    this.onImpact = onImpact;
  }

  reset() {
    this.phase = null;
    this.onImpact = null;
  }

  update(dt: number) {
    if (!this.phase) return;
    this.t += dt;
    if (this.phase === 'reveal' && this.t >= REVEAL_T) {
      this.phase = 'unleash';
      this.t = 0;
      this.onImpact?.();
      this.onImpact = null;
    } else if (this.phase === 'unleash' && this.t >= UNLEASH_T) {
      this.phase = 'fade';
      this.t = 0;
    } else if (this.phase === 'fade' && this.t >= FADE_T) {
      this.phase = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.phase) return;
    if (this.phase === 'reveal') this.drawReveal(ctx, w, h);
    else this.drawVortex(ctx, w, h, this.phase === 'fade');
  }

  /** Downsamples the art once to a tiny canvas; drawing it back up with smoothing off is what pixelates it. */
  private buildPortrait() {
    const iw = this.img.naturalWidth || 1;
    const ih = this.img.naturalHeight || 1;
    const bw = PORTRAIT_BLOCKS;
    const bh = Math.max(1, Math.round(bw * (ih / iw)));
    const small = document.createElement('canvas');
    small.width = bw;
    small.height = bh;
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(this.img, 0, 0, bw, bh);
    this.portrait = small;
  }

  /**
   * Manga-style splash: the whole screen only dims a little (gameplay stays visible under it),
   * a couple of diagonal pixel speed-lines streak across, and a tilted, parallelogram panel
   * (jagged pixel border, not a plain rectangle) pops in with the pixelated portrait and a
   * comic-shout "¡DOOM!".
   */
  private drawReveal(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;
    const t = Math.min(1, this.t / REVEAL_T);

    // Light overall dim: the page stays visible, it just steps back.
    const dim = Math.min(0.4, t * 1.6);
    ctx.fillStyle = `rgba(4,2,8,${dim.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);

    // Speed lines: a couple of thick diagonal pixel strokes shooting across, like a panel edge.
    const linesT = Math.min(1, t / 0.3);
    if (linesT > 0) {
      ctx.save();
      ctx.globalAlpha = linesT * (1 - Math.max(0, (t - 0.5) / 0.5));
      ctx.fillStyle = '#c23bff';
      const reach = (w + h) * linesT;
      pixelLine(ctx, -h * 0.3, h * 0.15 - reach * 0.3, -h * 0.3 + reach, h * 0.15 - reach * 0.3 + reach, 5);
      ctx.fillStyle = '#ff4828';
      pixelLine(ctx, w + h * 0.2, h * 0.75 + reach * 0.3, w + h * 0.2 - reach, h * 0.75 + reach * 0.3 - reach, 5);
      ctx.restore();
    }

    const panelT = Math.min(1, Math.max(0, (t - 0.18) / 0.42));
    if (panelT <= 0) return;
    const pop = overshoot(panelT);
    const panelW = Math.min(w * 0.72, 480);
    const iw = this.img.naturalWidth || 1;
    const ih = this.img.naturalHeight || 1;
    const panelH = panelW * (ih / iw);
    // The parallelogram lean: top edge shifted right, bottom edge shifted left (a dynamic manga cut).
    const skew = panelW * 0.1;
    const corners: [number, number][] = [
      [-panelW / 2 + skew, -panelH / 2],
      [panelW / 2 + skew, -panelH / 2],
      [panelW / 2 - skew, panelH / 2],
      [-panelW / 2 - skew, panelH / 2],
    ];
    // Torn-paper outline: like a ripped manga panel edge, not a clean cut. Built once per activation.
    if (!this.jagged) this.jagged = jaggedPoly(corners, Math.min(panelW, panelH) * 0.045);
    const pts = this.jagged;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.04);
    ctx.scale(pop, pop);

    // Panel background, then the pixelated portrait clipped to the same torn outline.
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = '#0b0b12';
    ctx.fill();
    if (this.portrait) {
      ctx.save();
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.portrait, -panelW / 2, -panelH / 2, panelW, panelH);
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
    }

    // Ripped pixel border: a light offset pass under a dark main pass, like the game's own cracks.
    for (const [color, off] of [['rgba(255,255,255,0.5)', 3], ['#05050a', 0]] as const) {
      ctx.fillStyle = color;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        pixelLine(ctx, x0 + off, y0 + off, x1 + off, y1 + off, 4);
      }
    }
    ctx.restore();

    if (panelT >= 1) {
      const shoutT = Math.min(1, (t - 0.65) / 0.3);
      if (shoutT > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, shoutT * 2);
        ctx.translate(cx, cy - panelH / 2 - 34);
        ctx.rotate(-0.08);
        const s = 1 + (1 - overshoot(shoutT)) * 0.4;
        ctx.scale(s, s);
        ctx.font = '32px "Press Start 2P", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0b0b12';
        for (const [tx, ty] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) ctx.fillText('¡DOOM!', tx, ty);
        ctx.fillStyle = '#c23bff';
        ctx.fillText('¡DOOM!', 0, 0);
        ctx.restore();
      }
    }
  }

  /** The wormhole: a growing dark void with concentric blocky rings spinning around its edge, torn open at the cursor. */
  private drawVortex(ctx: CanvasRenderingContext2D, w: number, h: number, fading: boolean) {
    const total = fading ? FADE_T : UNLEASH_T;
    const t = Math.min(1, this.t / total);
    const grow = fading ? 1 - easeOutCubic(t) : easeOutCubic(t);
    const maxR = Math.hypot(w, h) * 0.58;
    ctx.fillStyle = `rgba(6,2,10,${(fading ? 0.45 * (1 - t) : 0.5 * grow).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);

    const cx = this.ox;
    const cy = this.oy;
    // The hole itself: a filled, blocky dark void (not just outline rings) so it reads as a hole in the page.
    const holeR = maxR * grow * 0.55;
    ctx.fillStyle = `rgba(8,2,14,${Math.min(0.96, 0.6 + grow * 0.36).toFixed(3)})`;
    for (let rr = holeR; rr > 0; rr -= 5) pixelRing(ctx, cx, cy, rr, 5);

    const rings = 10;
    for (let i = 0; i < rings; i++) {
      const f = i / (rings - 1);
      const r = maxR * grow * (0.2 + f * 0.8);
      const spin = this.seed + (performance.now() / 1000) * (2.4 - f * 1.5) * (i % 2 === 0 ? 1 : -1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.fillStyle = vortexColor(f);
      pixelRing(ctx, 0, 0, Math.max(2, r), 4);
      ctx.restore();
    }
    // Bright core.
    ctx.fillStyle = `rgba(255,120,200,${(0.85 * grow).toFixed(3)})`;
    for (let i = 0; i < 10; i++) block(ctx, cx + (Math.random() - 0.5) * 18 * grow, cy + (Math.random() - 0.5) * 18 * grow, 4);
  }
}

/** Red at the rim, through magenta, to violet at the core: distinct from a flat purple void. */
export function vortexColor(f: number) {
  const stops: [number, number, number][] = [
    [255, 72, 40],
    [220, 40, 120],
    [150, 40, 220],
  ];
  const seg = Math.min(stops.length - 2, Math.floor(f * (stops.length - 1)));
  const lt = f * (stops.length - 1) - seg;
  const [r0, g0, b0] = stops[seg];
  const [r1, g1, b1] = stops[seg + 1];
  const r = Math.round(r0 + (r1 - r0) * lt);
  const g = Math.round(g0 + (g1 - g0) * lt);
  const b = Math.round(b0 + (b1 - b0) * lt);
  return `rgb(${r},${g},${b})`;
}

/** Subdivides a polygon's edges and jitters each point: turns a clean shape into a torn-paper outline. */
function jaggedPoly(corners: [number, number][], jitter: number, rand = Math.random): Poly {
  const pts: Poly = [];
  const segLen = 16;
  for (let i = 0; i < corners.length; i++) {
    const [x0, y0] = corners[i];
    const [x1, y1] = corners[(i + 1) % corners.length];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / segLen));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([x0 + (x1 - x0) * t + (rand() - 0.5) * jitter, y0 + (y1 - y0) * t + (rand() - 0.5) * jitter]);
    }
  }
  return pts;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** 0 → slightly past 1 → settles at 1 (a little pop for pickups/panels). */
function overshoot(t: number) {
  const c = 1.7;
  const x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}
