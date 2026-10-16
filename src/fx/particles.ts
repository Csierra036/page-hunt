// Physics and particles in stage coordinates (CSS px), drawn pixel-art style:
// square sparks, chips and dust, falling blocks (optionally textured with a piece
// of the page) that do not spin, block rings (impacts, crashes) and score popups.
import type { Poly } from '../core/damage';
import { PX, pixelRing } from './pixel';

const GRAVITY = 1700;
const MAX_PARTICLES = 1400;
const MAX_SHARDS = 260;

type Kind = 'spark' | 'chip' | 'dust' | 'smoke';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

export interface ShardTexture {
  image: CanvasImageSource;
  /** Texture position of the shard's local origin, and texture px per stage px. */
  ox: number;
  oy: number;
  scale: number;
}

interface Shard {
  poly: Poly;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  tex: ShardTexture | null;
  bounced: boolean;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Particles {
  parts: Particle[] = [];
  shards: Shard[] = [];
  rings: Ring[] = [];
  popups: Popup[] = [];
  floor = 800;

  clear() {
    this.parts = [];
    this.shards = [];
    this.rings = [];
    this.popups = [];
  }

  private add(p: Particle) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push(p);
  }

  sparks(x: number, y: number, n = 8, color = '#ffd36b') {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(200, 650);
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0, max: rnd(0.15, 0.35), size: rnd(1.5, 3), color });
    }
  }

  chips(x: number, y: number, color: string, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rnd(-Math.PI, 0);
      const v = rnd(120, 420);
      this.add({ kind: 'chip', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(0.6, 1.2), size: rnd(2, 5), color });
    }
  }

  dust(x: number, y: number, n = 6, color = 'rgba(180,170,160,0.5)', spread = 10) {
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'dust', x: x + rnd(-spread, spread), y: y + rnd(-spread, spread), vx: rnd(-60, 60), vy: rnd(-80, 10), life: 0, max: rnd(0.6, 1.4), size: rnd(6, 16), color });
    }
  }

  smoke(x: number, y: number, n = 4) {
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'smoke', x, y, vx: rnd(-30, 30), vy: rnd(-90, -30), life: 0, max: rnd(0.5, 1), size: rnd(6, 12), color: 'rgba(210,210,210,0.35)' });
    }
  }

  /** A shard at (x, y) whose polygon is relative to that point. */
  shard(poly: Poly, x: number, y: number, vx: number, vy: number, color: string, tex: ShardTexture | null = null) {
    if (this.shards.length >= MAX_SHARDS) this.shards.shift();
    this.shards.push({ poly, x, y, vx, vy, life: rnd(2.2, 3.4), color, tex, bounced: false });
  }

  /**
   * Breaks a rectangle (stage coords) into falling shards. `polys` are in the rectangle's
   * local coords; each shard is re-centred on its centroid so it spins around it.
   */
  shatterRect(x: number, y: number, polys: Poly[], color: string, tex: ShardTexture | null, push = 1, fromX = x, fromY = y) {
    for (const poly of polys) {
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const local: Poly = poly.map(([px, py]) => [px - cx, py - cy]);
      const sx = x + cx;
      const sy = y + cy;
      const a = Math.atan2(sy - fromY, sx - fromX);
      const v = rnd(60, 260) * push;
      const t = tex ? { image: tex.image, ox: tex.ox + cx * tex.scale, oy: tex.oy + cy * tex.scale, scale: tex.scale } : null;
      this.shard(local, sx, sy, Math.cos(a) * v, Math.sin(a) * v - rnd(80, 260) * push, color, t);
    }
  }

  ring(x: number, y: number, max: number, color = 'rgba(255,240,200,0.9)') {
    this.rings.push({ x, y, r: 4, max, life: 0, color });
  }

  popup(x: number, y: number, text: string, color = '#ffe066', size = 18) {
    this.popups.push({ x, y, text, color, size, life: 0 });
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life += dt;
      if (p.kind === 'smoke' || p.kind === 'dust') {
        p.vx *= 1 - dt * 2;
        p.vy *= 1 - dt * 2;
        p.size += dt * 14;
      } else {
        p.vy += GRAVITY * dt * (p.kind === 'spark' ? 0.5 : 1);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);

    for (const s of this.shards) {
      s.life -= dt;
      s.vy += GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (!s.bounced && s.y > this.floor - 6) {
        s.bounced = true;
        s.y = this.floor - 6;
        s.vy *= -0.35;
        s.vx *= 0.5;
        s.life = Math.min(s.life, 0.7);
      }
    }
    this.shards = this.shards.filter((s) => s.life > 0 && s.y < this.floor + 400);

    for (const r of this.rings) {
      r.life += dt;
      r.r = r.max * (1 - Math.pow(1 - Math.min(1, r.life / 0.45), 3));
    }
    this.rings = this.rings.filter((r) => r.life < 0.55);

    for (const p of this.popups) {
      p.life += dt;
      p.y -= dt * 40;
    }
    this.popups = this.popups.filter((p) => p.life < 1.1);

  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const s of this.shards) {
      // Blocks keep their orientation and move on whole pixels: no smooth spinning.
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      ctx.save();
      ctx.globalAlpha = s.life < 0.5 ? (Math.ceil(s.life * 6) / 3) : 1;
      ctx.translate(x, y);
      ctx.beginPath();
      s.poly.forEach(([px, py], i) => (i ? ctx.lineTo(Math.round(px), Math.round(py)) : ctx.moveTo(Math.round(px), Math.round(py))));
      ctx.closePath();
      if (s.tex) {
        ctx.save();
        ctx.clip();
        const k = 1 / s.tex.scale;
        const img = s.tex.image as HTMLCanvasElement;
        ctx.drawImage(img, Math.round(-s.tex.ox * k), Math.round(-s.tex.oy * k), img.width * k, img.height * k);
        ctx.restore();
      } else {
        ctx.fillStyle = s.color;
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    for (const p of this.parts) {
      const t = p.life / p.max;
      // Fade in steps, like a sprite with a few frames.
      ctx.globalAlpha = Math.max(0.15, Math.ceil((1 - t) * 4) / 4);
      ctx.fillStyle = p.color;
      const size = Math.max(PX, Math.round(p.size / PX) * PX);
      ctx.fillRect(Math.round((p.x - size / 2) / PX) * PX, Math.round((p.y - size / 2) / PX) * PX, size, size);
    }
    ctx.globalAlpha = 1;

    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0.2, Math.ceil((1 - r.life / 0.55) * 4) / 4);
      ctx.fillStyle = r.color;
      pixelRing(ctx, r.x, r.y, r.r, 5);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, (1.1 - p.life) * 3);
      ctx.font = `700 ${p.size}px "Press Start 2P", ui-monospace, monospace`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(p.text, Math.round(p.x), Math.round(p.y));
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
    }
    ctx.globalAlpha = 1;
  }
}
