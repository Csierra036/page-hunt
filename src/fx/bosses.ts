// Bosses: one every 5 rounds (5, 10, 15, 20), each with its own way of fighting.
// Their attacks are projectiles the player can shoot down; the ones that get through
// (or a dive/laser that catches the crosshair) cost a heart. As they lose health they
// look more and more wounded (bandages, cracks, smoke) and below a third they get angry.
//
//  - Mamá Pato:   sways across the sky dropping eggs; an egg that reaches the ground
//                 costs a heart and smashes the page. Calls ducklings for help.
//  - Halcón Ninja: hovers, throws homing feathers, then marks the crosshair and dives at
//                 it: move away or shoot it mid-dive (double damage).
//  - Mecha-Pato:  armoured. Fires homing rockets and sweeps a laser across the row the
//                 crosshair is in. It can only be hurt while its core vents after the laser.
//  - Rey Fantasma: teleports leaving decoys, fades out (untouchable) and fires rings of
//                 orbs; the decoys fire their own rings too. Only the real one takes damage.
import { MAX_ROUND } from '../core/score';

export { MAX_ROUND };
import { duckSprite, SW, type Palette } from './ducks';
import { block, pixelLine } from './pixel';
import type { Particles } from './particles';

export type BossKind = 'mama' | 'hawk' | 'mecha' | 'king';

export const BOSS_ORDER: BossKind[] = ['mama', 'hawk', 'mecha', 'king'];

export const BOSSES: Record<BossKind, { name: string; hp: number; points: number; palette: Palette }> = {
  mama: { name: 'MAMÁ PATO', hp: 70, points: 5000, palette: { head: '#2f8f4e', body: '#8a5a2b', belly: '#e0c08a', wing: '#6b4220' } },
  hawk: { name: 'HALCÓN NINJA', hp: 100, points: 8000, palette: { head: '#232331', body: '#2c2c3c', belly: '#5b5b74', wing: '#17171f' } },
  mecha: { name: 'MECHA-PATO', hp: 130, points: 12000, palette: { head: '#8d99a6', body: '#5d6874', belly: '#b9c3cc', wing: '#3d4650' } },
  king: { name: 'REY FANTASMA', hp: 170, points: 20000, palette: { head: '#d9d4ff', body: '#b8b0f0', belly: '#efeaff', wing: '#8f86d6' } },
};

/** The boss that appears at this round, if any. */
export function bossForRound(round: number): BossKind | null {
  if (round % 5 !== 0 || round < 5 || round > MAX_ROUND) return null;
  return BOSS_ORDER[round / 5 - 1];
}

export interface BossHost {
  readonly w: number;
  readonly h: number;
  readonly aim: { x: number; y: number };
  readonly particles: Particles;
  /** The player was hit at (x, y). */
  hurtPlayer(x: number, y: number): void;
  /** Extra ducks join the fight. */
  frenzy(n: number): void;
  /** Area damage on the page (eggs smashing it, the laser). */
  blastPage(x: number, y: number, radius: number, power: number): void;
}

type ProjectileKind = 'egg' | 'feather' | 'rocket' | 'orb';

interface Projectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  t: number;
  life: number;
  /** Turn rate towards the crosshair (rad/s). */
  homing: number;
}

interface Decoy {
  x: number;
  y: number;
}

export type ShotResult =
  | { what: 'projectile'; destroyed: boolean }
  | { what: 'boss'; damage: number }
  | { what: 'armor' }
  | { what: 'decoy' }
  | null;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Boss {
  readonly name: string;
  readonly max: number;
  hp: number;
  x: number;
  y: number;
  t = 0;
  phase = 'enter';
  phaseT = 0;
  flash = 0;
  /** 0 → 1 while dying; removed at 1. */
  dying = 0;
  projectiles: Projectile[] = [];
  decoys: Decoy[] = [];
  /** Mecha: the core is exposed (the only time it takes damage). */
  coreOpen = false;
  /** King: faded out and untouchable. */
  alpha = 1;
  private target = { x: 0, y: 0 };
  private laserY = 0;
  private timer = 0;
  private summonT = 8;
  private facing = 1;

  constructor(readonly kind: BossKind, private host: BossHost) {
    this.name = BOSSES[kind].name;
    this.max = this.hp = BOSSES[kind].hp;
    this.x = host.w / 2;
    this.y = -200;
  }

  get enraged() {
    return this.hp < this.max / 3;
  }

  /** 0 healthy … 3 badly hurt: drives the wound overlays. */
  get wounds() {
    return Math.min(3, Math.floor((1 - this.hp / this.max) * 4));
  }

  get dead() {
    return this.dying >= 1;
  }

  /** Sprite scale so the boss is big but fits small screens. */
  private get k() {
    return Math.max(4, Math.round(Math.min(220, this.host.w * 0.24) / (SW + 2)));
  }

  private get half() {
    return ((SW + 2) * this.k) / 2;
  }

  private inBody(x: number, y: number, bx = this.x, by = this.y) {
    const hw = this.half * 0.8;
    return Math.abs(x - bx) < hw && Math.abs(y - by) < hw * 0.8;
  }

  /** A bullet at (x, y): projectiles first, then decoys, then the boss itself. */
  shoot(x: number, y: number, damage: number): ShotResult {
    if (this.dying > 0) return null;
    for (const p of this.projectiles) {
      if (Math.hypot(p.x - x, p.y - y) <= p.r + 6) {
        p.hp -= damage;
        const destroyed = p.hp <= 0;
        if (destroyed) this.popProjectile(p);
        return { what: 'projectile', destroyed };
      }
    }
    for (const d of this.decoys) {
      if (this.inBody(x, y, d.x, d.y)) {
        this.decoys = this.decoys.filter((q) => q !== d);
        this.host.particles.dust(d.x, d.y, 14, 'rgba(200,190,255,0.6)', this.half * 0.4);
        return { what: 'decoy' };
      }
    }
    if (!this.inBody(x, y) || this.phase === 'enter') return null;
    return this.hurt(damage);
  }

  /** Rocket explosion: wipes projectiles and decoys in range and hurts the boss. */
  blast(x: number, y: number, radius: number, power: number): ShotResult {
    if (this.dying > 0) return null;
    for (const p of this.projectiles) if (Math.hypot(p.x - x, p.y - y) < radius) this.popProjectile(p);
    this.decoys = this.decoys.filter((d) => Math.hypot(d.x - x, d.y - y) >= radius);
    if (Math.hypot(this.x - x, this.y - y) > radius + this.half * 0.6 || this.phase === 'enter') return null;
    return this.hurt(power);
  }

  private hurt(amount: number): ShotResult {
    if (this.kind === 'mecha' && !this.coreOpen) {
      this.host.particles.sparks(this.x, this.y, 4, '#dfe6ee');
      return { what: 'armor' };
    }
    if (this.kind === 'king' && this.alpha < 0.5) return null;
    const mult = this.kind === 'hawk' && this.phase === 'dive' ? 2 : this.kind === 'mecha' ? 1.5 : 1;
    const dmg = Math.min(this.hp, amount * mult);
    this.hp -= dmg;
    this.flash = 0.12;
    if (this.hp <= 0) {
      this.dying = 0.001;
      this.projectiles = [];
      this.decoys = [];
    }
    return { what: 'boss', damage: dmg };
  }

  private popProjectile(p: Projectile) {
    p.hp = 0;
    p.life = 0;
    this.host.particles.sparks(p.x, p.y, 8, p.kind === 'orb' ? '#c9b8ff' : '#ffd36b');
    this.host.particles.dust(p.x, p.y, 3, 'rgba(220,220,220,0.5)', 4);
  }

  private setPhase(phase: string) {
    this.phase = phase;
    this.phaseT = 0;
    if (phase === 'hover') this.target = { x: rnd(this.host.w * 0.15, this.host.w * 0.85), y: rnd(this.host.h * 0.12, this.host.h * 0.35) };
  }

  private moveTo(tx: number, ty: number, dt: number, speed = 3) {
    const dx = tx - this.x;
    if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1;
    this.x += dx * Math.min(1, dt * speed);
    this.y += (ty - this.y) * Math.min(1, dt * speed);
  }

  private orbRing(x: number, y: number, n: number, speed: number, offset: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + offset;
      this.fire('orb', x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
  }

  private fire(kind: ProjectileKind, x: number, y: number, vx: number, vy: number, opts: Partial<Projectile> = {}) {
    const base = { egg: [11, 1, 12], feather: [8, 1, 5], rocket: [10, 2, 6], orb: [8, 1, 6] }[kind];
    this.projectiles.push({ kind, x, y, vx, vy, r: base[0], hp: base[1], t: 0, life: base[2], homing: 0, ...opts });
  }

  update(dt: number) {
    const { w, h, aim } = this.host;
    this.t += dt;
    this.phaseT += dt;
    this.flash = Math.max(0, this.flash - dt);

    if (this.dying > 0) {
      this.dying += dt / 1.8;
      if (Math.random() < 0.5) {
        const ex = this.x + rnd(-this.half, this.half);
        const ey = this.y + rnd(-this.half * 0.7, this.half * 0.7);
        this.host.particles.sparks(ex, ey, 10, '#ffb020');
        this.host.particles.dust(ex, ey, 4, 'rgba(60,50,45,0.6)', 10);
      }
      this.y += dt * 40;
      return;
    }

    // Wounded: smoke and sparks the worse it gets.
    if (this.wounds >= 2 && Math.random() < dt * (this.wounds * 4)) this.host.particles.smoke(this.x + rnd(-20, 20), this.y - this.half * 0.4, 2);
    if (this.wounds >= 3 && Math.random() < dt * 6) this.host.particles.sparks(this.x + rnd(-30, 30), this.y + rnd(-20, 20), 3, '#ffcc33');

    const rage = this.enraged ? 1.6 : 1;
    if (this.phase === 'enter') {
      this.moveTo(w / 2, h * 0.24, dt, 2);
      if (this.phaseT > 1.6) this.setPhase(this.kind === 'mama' ? 'sway' : this.kind === 'hawk' ? 'hover' : this.kind === 'mecha' ? 'patrol' : 'float');
    } else if (this.kind === 'mama') {
      this.moveTo(w / 2 + Math.sin(this.t * 0.5 * rage) * w * 0.33, h * 0.22 + Math.sin(this.t * 1.1) * h * 0.07, dt);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 2.2 / rage;
        this.fire('egg', this.x, this.y + this.half * 0.4, rnd(-50, 50), 40, { life: 99 });
      }
      this.summonT -= dt;
      if (this.summonT <= 0) {
        this.summonT = 9;
        this.host.frenzy(2);
      }
    } else if (this.kind === 'hawk') {
      if (this.phase === 'hover') {
        this.moveTo(this.target.x, this.target.y, dt);
        if (this.phaseT >= 0.8 && this.phaseT - dt < 0.8) {
          for (let i = -1; i <= 1; i++) {
            const a = Math.atan2(aim.y - this.y, aim.x - this.x) + i * 0.5;
            this.fire('feather', this.x, this.y, Math.cos(a) * 170, Math.sin(a) * 170, { homing: 1.3 });
          }
        }
        if (this.phaseT > 2.2 / rage) {
          this.target = { x: aim.x, y: aim.y };
          this.setPhase('aim');
        }
      } else if (this.phase === 'aim') {
        this.x += Math.sin(this.t * 60) * 2;
        if (this.phaseT > 0.75 / Math.sqrt(rage)) this.setPhase('dive');
      } else if (this.phase === 'dive') {
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const d = Math.hypot(dx, dy);
        const step = 950 * rage * dt;
        if (d <= step) {
          this.x = this.target.x;
          this.y = this.target.y;
          if (Math.hypot(aim.x - this.target.x, aim.y - this.target.y) < 55) this.host.hurtPlayer(this.x, this.y);
          this.host.particles.dust(this.x, this.y, 10, 'rgba(200,200,200,0.5)', 20);
          this.setPhase('recover');
        } else {
          this.facing = dx > 0 ? 1 : -1;
          this.x += (dx / d) * step;
          this.y += (dy / d) * step;
        }
      } else if (this.phase === 'recover') {
        this.moveTo(this.x, h * 0.2, dt, 2);
        if (this.phaseT > 0.9) this.setPhase('hover');
      }
    } else if (this.kind === 'mecha') {
      if (this.phase === 'patrol') {
        this.coreOpen = false;
        this.moveTo(w / 2 + Math.sin(this.t * 0.7) * w * 0.32, h * 0.2, dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 1.1 / rage;
          const a = Math.atan2(aim.y - this.y, aim.x - this.x);
          this.fire('rocket', this.x, this.y + this.half * 0.3, Math.cos(a) * 220, Math.sin(a) * 220, { homing: 0.7 });
        }
        if (this.phaseT > 3.2) {
          this.laserY = aim.y;
          this.setPhase('charge');
        }
      } else if (this.phase === 'charge') {
        // Telegraphed: the band follows the crosshair a little, then locks.
        if (this.phaseT < 0.6) this.laserY += (aim.y - this.laserY) * Math.min(1, dt * 3);
        if (this.phaseT > 1.25 / Math.sqrt(rage)) {
          this.setPhase('laser');
          for (let x = 60; x < w; x += 160) this.host.blastPage(x, this.laserY, 50, 2);
        }
      } else if (this.phase === 'laser') {
        if (Math.abs(aim.y - this.laserY) < 24) this.host.hurtPlayer(aim.x, this.laserY);
        if (this.phaseT > 0.6) this.setPhase('vent');
      } else if (this.phase === 'vent') {
        this.coreOpen = true;
        if (Math.random() < dt * 10) this.host.particles.smoke(this.x, this.y - this.half * 0.3, 2);
        if (this.phaseT > 2.6) this.setPhase('patrol');
      }
    } else if (this.kind === 'king') {
      if (this.phase === 'float') {
        this.alpha = Math.min(1, this.alpha + dt * 3);
        this.moveTo(this.x + Math.sin(this.t) * 30, this.y + Math.cos(this.t * 1.3) * 10, dt, 1);
        if (this.phaseT >= 1.2 && this.phaseT - dt < 1.2) {
          const n = this.enraged ? 12 : 8;
          const speed = this.enraged ? 175 : 130;
          this.orbRing(this.x, this.y, n, speed, this.t);
          // The decoys fire too, so the real one cannot be told apart by who shoots.
          // Slightly smaller, slower rings, rotated so they leave gaps to slip through.
          this.decoys.forEach((d, i) => this.orbRing(d.x, d.y, n - 2, speed * 0.85, this.t + (i + 1) * 0.4));
        }
        if (this.phaseT > 2.8 / Math.sqrt(rage)) this.setPhase('fade');
      } else if (this.phase === 'fade') {
        this.alpha = Math.max(0.12, this.alpha - dt * 2);
        if (this.phaseT > 0.8) {
          const spot = () => ({ x: rnd(w * 0.15, w * 0.85), y: rnd(h * 0.15, h * 0.5) });
          const p = spot();
          this.x = p.x;
          this.y = p.y;
          this.decoys = Array.from({ length: this.enraged ? 3 : 2 }, spot);
          this.setPhase('float');
        }
      }
    }

    // Projectiles.
    for (const p of this.projectiles) {
      p.t += dt;
      if (p.kind === 'egg') p.vy += 220 * dt;
      if (p.homing) {
        const want = Math.atan2(aim.y - p.y, aim.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        let diff = want - cur;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = Math.max(-p.homing * dt, Math.min(p.homing * dt, diff));
        const speed = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(cur + turn) * speed;
        p.vy = Math.sin(cur + turn) * speed;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'egg') {
        if (p.y >= h - 14) {
          // An egg that reaches the ground costs a heart and smashes the page.
          this.host.hurtPlayer(p.x, p.y);
          this.host.blastPage(p.x, h - 30, 80, 4);
          this.host.particles.chips(p.x, h - 14, '#fff7e0', 10);
          this.host.particles.chips(p.x, h - 14, '#f2c14e', 6);
          p.life = 0;
        }
      } else if (Math.hypot(p.x - aim.x, p.y - aim.y) < p.r + 6) {
        this.host.hurtPlayer(p.x, p.y);
        p.life = 0;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.life && p.x > -60 && p.x < w + 60 && p.y > -60 && p.y < h + 60);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w } = this.host;
    // Telegraphs and the laser go under the boss.
    if (this.kind === 'hawk' && this.phase === 'aim' && Math.floor(this.phaseT * 12) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,60,60,0.9)';
      pixelLine(ctx, this.x, this.y, this.target.x, this.target.y, 4);
      ctx.fillStyle = 'rgba(255,60,60,0.5)';
      ctx.fillRect(Math.round(this.target.x) - 18, Math.round(this.target.y) - 2, 36, 4);
      ctx.fillRect(Math.round(this.target.x) - 2, Math.round(this.target.y) - 18, 4, 36);
    }
    if (this.kind === 'mecha' && this.phase === 'charge' && Math.floor(this.phaseT * 10) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,40,40,0.25)';
      ctx.fillRect(0, Math.round(this.laserY) - 24, w, 48);
      ctx.fillStyle = 'rgba(255,40,40,0.9)';
      for (let x = 0; x < w; x += 16) {
        ctx.fillRect(x, Math.round(this.laserY) - 24, 8, 3);
        ctx.fillRect(x, Math.round(this.laserY) + 21, 8, 3);
      }
    }
    if (this.kind === 'mecha' && this.phase === 'laser') {
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(0, Math.round(this.laserY) - 20, w, 40);
      ctx.fillStyle = '#ffe0e0';
      ctx.fillRect(0, Math.round(this.laserY) - 7, w, 14);
    }

    for (const d of this.decoys) this.drawBody(ctx, d.x, d.y, this.alpha * 0.95, false);
    this.drawBody(ctx, this.x, this.y, this.kind === 'king' ? this.alpha * 0.9 : 1, true);

    for (const p of this.projectiles) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (p.kind === 'egg') {
        ctx.fillStyle = '#111';
        ctx.fillRect(x - 9, y - 12, 18, 24);
        ctx.fillStyle = '#fff7e0';
        ctx.fillRect(x - 7, y - 10, 14, 20);
        ctx.fillStyle = '#e8d9b0';
        ctx.fillRect(x - 7, y + 4, 14, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 5, y - 8, 4, 4);
      } else if (p.kind === 'feather') {
        ctx.fillStyle = '#111';
        block(ctx, x - 6, y, 4);
        block(ctx, x - 2, y - 4, 4);
        block(ctx, x - 2, y, 4);
        block(ctx, x + 2, y, 4);
        block(ctx, x - 2, y + 4, 4);
        ctx.fillStyle = '#5b5b74';
        block(ctx, x - 2, y, 4);
      } else if (p.kind === 'rocket') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.round(Math.atan2(p.vy, p.vx) / (Math.PI / 4)) * (Math.PI / 4));
        ctx.fillStyle = '#111';
        ctx.fillRect(-12, -6, 24, 12);
        ctx.fillStyle = '#b9c3cc';
        ctx.fillRect(-10, -4, 16, 8);
        ctx.fillStyle = '#e0533f';
        ctx.fillRect(6, -4, 4, 8);
        if (Math.floor(p.t * 20) % 2 === 0) {
          ctx.fillStyle = '#ffb020';
          ctx.fillRect(-18, -3, 6, 6);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(160,140,255,0.35)';
        ctx.fillRect(x - 10, y - 10, 20, 20);
        ctx.fillStyle = '#c9b8ff';
        ctx.fillRect(x - 6, y - 6, 12, 12);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number, real: boolean) {
    const k = this.k;
    const frame = this.dying > 0 || (this.kind === 'hawk' && this.phase === 'dive') ? 'hit' : (['up', 'mid', 'down', 'mid'] as const)[Math.floor(this.t * 8) % 4];
    const img = duckSprite(BOSSES[this.kind].palette, frame);
    const size = img.width * k;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha * (this.dying > 0 ? Math.max(0, 1 - this.dying) : 1);
    ctx.translate(Math.round(x), Math.round(y));
    if (this.kind === 'hawk' && this.phase === 'aim') ctx.translate(Math.round(Math.sin(this.t * 60) * 3), 0);
    ctx.scale(this.facing, 1);
    if (real && this.flash > 0) ctx.filter = 'brightness(3)';
    ctx.translate(-size / 2, -size / 2);
    ctx.drawImage(img, 0, 0, size, size * (img.height / img.width));
    ctx.filter = 'none';
    // Overlays in sprite-grid units (the sprite has a 1 px outline: grid x maps to x + 1).
    const g = (gx: number, gy: number, gw: number, gh: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect((gx + 1) * k, (gy + 1) * k, gw * k, gh * k);
    };
    if (this.kind === 'mama') {
      g(13, 1, 2, 2, '#ff5fa2'); // bow
      g(16, 1, 2, 2, '#ff5fa2');
      g(15, 2, 1, 1, '#c2185b');
    } else if (this.kind === 'hawk') {
      g(12, 4, 7, 1, '#e0312b'); // headband
      g(10, 5, 2, 1, '#e0312b');
      g(9, 6, 2, 1, '#e0312b');
    } else if (this.kind === 'mecha') {
      g(15, 3, 4, 2, '#1a1f24'); // visor
      g(16, 3, 2, 1, real && this.coreOpen ? '#ff3b3b' : '#45d483');
      g(15, 0, 1, 3, '#3d4650'); // antenna
      if (!this.coreOpen) {
        g(2, 9, 12, 5, '#7c8794'); // armour plate
        g(2, 9, 12, 1, '#c7d0d8');
        g(4, 11, 1, 1, '#3d4650');
        g(11, 11, 1, 1, '#3d4650');
      } else if (Math.floor(this.t * 8) % 2 === 0) {
        g(6, 10, 5, 3, '#ff3b3b'); // exposed core
        g(7, 11, 3, 1, '#ffe0e0');
      }
    } else if (this.kind === 'king') {
      g(13, 0, 6, 2, '#f5c542'); // crown
      g(13, -1, 1, 1, '#f5c542');
      g(15, -1, 1, 1, '#f5c542');
      g(17, -1, 1, 1, '#f5c542');
      g(15, 0, 1, 1, '#e0312b');
    }
    // Wounds, worse with every quarter of health lost.
    if (real && this.wounds >= 1) {
      g(5, 10, 4, 1, '#f2f0ff'); // bandage
      g(6, 9, 2, 3, '#f2f0ff');
    }
    if (real && this.wounds >= 2) {
      g(10, 11, 1, 1, '#111');
      g(11, 12, 1, 1, '#111');
      g(12, 12, 1, 1, '#111');
      g(14, 7, 1, 1, '#111');
      g(15, 8, 1, 1, '#111');
    }
    if (real && this.wounds >= 3) {
      g(16, 4, 1, 1, '#e0312b'); // black eye / bruise
      g(3, 12, 2, 1, '#e0312b');
    }
    ctx.restore();
  }
}
