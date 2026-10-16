// Ally ducks: they only come out of "A" crates during boss fights. Each one flies
// around the lower part of the stage for a while and shoots on its own: first the
// boss's projectiles (to protect the player), then the boss itself. They follow the
// same rules as the player's bullets (Mecha-Pato's armour, the ghost king fading).
import type { Boss, ShotResult } from './bosses';
import { duckSprite, type Palette } from './ducks';
import { pixelLine } from './pixel';

const LIFE = 15;
const FIRE_DELAY = 0.6;
const DAMAGE = 1.5;
const ACCURACY = 0.85;
export const MAX_ALLIES = 3;

const PALETTE: Palette = { head: '#2e9df0', body: '#f2f0ff', belly: '#ffffff', wing: '#7cc4ff' };

interface Ally {
  x: number;
  y: number;
  t: number;
  life: number;
  cooldown: number;
  dest: { x: number; y: number };
  destT: number;
  leaving: boolean;
  facing: number;
  /** Last shot, for the tracer. */
  tracer: { x: number; y: number; t: number } | null;
}

export class Allies {
  list: Ally[] = [];
  /** Shots fired and hits, for stats and tests. */
  shots = 0;
  hits = 0;

  constructor(private onHit: (r: NonNullable<ShotResult>, x: number, y: number) => void, private onShot: () => void) {}

  clear() {
    this.list = [];
  }

  get active() {
    return this.list.filter((a) => !a.leaving).length;
  }

  /** A crate was collected: a new ally, or more time for the oldest one when full. */
  spawn(w: number, h: number) {
    const fighting = this.list.filter((a) => !a.leaving);
    if (fighting.length >= MAX_ALLIES) {
      const oldest = fighting.reduce((a, b) => (a.t > b.t ? a : b));
      oldest.t = 0;
      oldest.life = LIFE;
      return;
    }
    const fromLeft = Math.random() < 0.5;
    this.list.push({
      x: fromLeft ? -40 : w + 40,
      y: h * 0.7,
      t: 0,
      life: LIFE,
      cooldown: 0.8,
      dest: { x: w * (fromLeft ? 0.25 : 0.75), y: h * 0.65 },
      destT: 2,
      leaving: false,
      facing: fromLeft ? 1 : -1,
      tracer: null,
    });
  }

  /** The boss is gone: everyone flies away. */
  dismiss() {
    for (const a of this.list) a.leaving = true;
  }

  update(dt: number, boss: Boss | null, w: number, h: number) {
    for (const a of this.list) {
      a.t += dt;
      if (a.tracer) a.tracer.t += dt;
      if (a.t >= a.life || !boss) a.leaving = true;
      if (a.leaving) {
        a.y -= 260 * dt;
        a.x += a.facing * 120 * dt;
        continue;
      }
      // Wander around the lower part of the stage, out of the way of the crosshair's usual area.
      a.destT -= dt;
      if (a.destT <= 0) {
        a.destT = 1.5 + Math.random() * 1.5;
        a.dest = { x: w * (0.1 + Math.random() * 0.8), y: h * (0.55 + Math.random() * 0.25) };
      }
      a.x += (a.dest.x - a.x) * Math.min(1, dt * 2);
      a.y += (a.dest.y - a.y) * Math.min(1, dt * 2) + Math.sin(a.t * 5) * 0.4;

      a.cooldown -= dt;
      if (!boss || boss.dying > 0 || a.cooldown > 0) continue;
      a.cooldown = FIRE_DELAY;
      // Threats first: the projectile closest to hurting the player (lowest on screen).
      const threat = boss.projectiles.filter((p) => p.hp > 0 && p.t < p.life).sort((p, q) => q.y - p.y)[0];
      const target = threat ? { x: threat.x, y: threat.y } : { x: boss.x, y: boss.y };
      a.facing = target.x >= a.x ? 1 : -1;
      this.shots++;
      this.onShot();
      if (Math.random() > ACCURACY) {
        a.tracer = { x: target.x + (Math.random() - 0.5) * 80, y: target.y + (Math.random() - 0.5) * 80, t: 0 };
        continue;
      }
      a.tracer = { ...target, t: 0 };
      const r = boss.shoot(target.x, target.y, DAMAGE);
      if (r) {
        this.hits++;
        this.onHit(r, target.x, target.y);
      }
    }
    this.list = this.list.filter((a) => a.y > -80 && a.x > -120 && a.x < w + 120);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const a of this.list) {
      if (a.tracer && a.tracer.t < 0.07) {
        ctx.fillStyle = '#9fe3ff';
        pixelLine(ctx, a.x + a.facing * 20, a.y, a.tracer.x, a.tracer.y, 3);
      }
      // Blink while the time runs out.
      if (!a.leaving && a.life - a.t < 3 && Math.floor(a.t * 8) % 2 === 0) continue;
      const img = duckSprite(PALETTE, (['up', 'mid', 'down', 'mid'] as const)[Math.floor(a.t * 12) % 4]);
      // A bit bigger than the wild ducks so allies stand out.
      const k = 4;
      const w = img.width * k;
      const h = img.height * k;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(Math.round(a.x), Math.round(a.y));
      ctx.scale(a.facing, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      // Sunglasses and a small blaster, in sprite pixels (k px each; grid x maps to x + 1).
      const g = (gx: number, gy: number, gw: number, gh: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(-w / 2 + (gx + 1) * k, -h / 2 + (gy + 1) * k, gw * k, gh * k);
      };
      g(14, 4, 5, 1, '#111');
      g(15, 5, 1, 1, '#111');
      g(17, 5, 1, 1, '#111');
      g(10, 12, 6, 2, '#3d4650');
      g(15, 11, 2, 1, '#3d4650');
      if (a.tracer && a.tracer.t < 0.05) g(16, 12, 2, 2, '#fff3b0');
      ctx.restore();
    }
  }
}
