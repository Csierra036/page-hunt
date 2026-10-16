// The cursor is the weapon: a pixel reticle with the remaining shells next to it,
// a reload arc (with the active-reload sweet spot) and a kick when firing.
import type { BonusId, Weapon } from '../core/weapon';
import { BONUS_COLORS } from './pickups';
import { block, pixelArc, pixelRing } from './pixel';

const S = 2;

export class Reticle {
  /** 0..1 recoil kick, decays every frame. */
  kick = 0;
  /** Seconds left of the muzzle burst drawn at the aim point. */
  flash = 0;

  fire(strength: number) {
    this.kick = Math.min(1, this.kick + strength);
    this.flash = 0.06;
  }

  update(dt: number) {
    this.kick = Math.max(0, this.kick - dt * 6);
    this.flash = Math.max(0, this.flash - dt);
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, spread: number, wpn: Weapon, reloadKey: string, t: number) {
    const state = wpn.reloading ? 'reloading' : wpn.ammo === 0 ? 'empty' : 'ready';
    const color = state === 'ready' ? '#ffffff' : state === 'reloading' ? '#ffcc33' : '#ff5a5a';
    // The reticle jumps up on recoil and blooms a little.
    const ky = Math.round(-this.kick * 8);
    const cy = y + ky;
    const gap = 5 + Math.round(this.kick * 6);
    const arm = 9;

    if (this.flash > 0) {
      ctx.fillStyle = '#fff3b0';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = 6 + Math.random() * 14;
        block(ctx, x + Math.cos(a) * r, cy + Math.sin(a) * r, 4);
      }
    }

    // Shotgun spread: a faint dotted ring.
    if (spread > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      pixelRing(ctx, x, cy, spread + this.kick * 8, S);
    }

    // Arms: dark outline then colour, all on the 2px grid.
    for (const [c, pad] of [['rgba(0,0,0,0.8)', S], [color, 0]] as const) {
      ctx.fillStyle = c;
      ctx.fillRect(x - gap - arm - pad, cy - S / 2 - pad, arm + pad * 2, S + pad * 2);
      ctx.fillRect(x + gap - pad, cy - S / 2 - pad, arm + pad * 2, S + pad * 2);
      ctx.fillRect(x - S / 2 - pad, cy - gap - arm - pad, S + pad * 2, arm + pad * 2);
      ctx.fillRect(x - S / 2 - pad, cy + gap - pad, S + pad * 2, arm + pad * 2);
      ctx.fillRect(x - S / 2 - pad, cy - S / 2 - pad, S + pad * 2, S + pad * 2);
    }

    // Reload arc around the reticle, with the sweet spot in green until it is tried.
    const r = gap + arm + 8;
    if (wpn.reloading) {
      const start = -Math.PI / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      pixelArc(ctx, x, cy, r, start, start + Math.PI * 2, S + 1);
      if (!wpn.activeTried) {
        const [a, b] = wpn.def.sweet;
        ctx.fillStyle = '#45d483';
        pixelArc(ctx, x, cy, r, start + a * Math.PI * 2, start + b * Math.PI * 2, S + 1);
      }
      ctx.fillStyle = wpn.jammed ? '#ff5a5a' : '#ffcc33';
      pixelArc(ctx, x, cy, r, start, start + wpn.progress * Math.PI * 2, S + 1);
    }

    // Ammo to the lower right of the cursor.
    const sx = x + 16;
    const sy = cy + 16;
    ctx.font = '8px "Press Start 2P", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (wpn.def.bonus) {
      // Bonus weapon: its letter in a crate colour and the rounds left as a number.
      const label = `${wpn.def.letter} ${wpn.ammo}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(sx - 3, sy - 3, tw + 6, 14);
      ctx.fillStyle = BONUS_COLORS[wpn.def.id as BonusId];
      ctx.fillText(label, sx, sy);
      return;
    }
    // Shotgun shells: red hull, brass base.
    const sw = 5;
    const sh = 9;
    for (let i = 0; i < wpn.def.mag; i++) {
      const bx = sx + i * (sw + 2);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(bx - 1, sy - 1, sw + 2, sh + 2);
      if (i >= wpn.ammo) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(bx, sy, sw, sh);
        continue;
      }
      ctx.fillStyle = '#d63a2f';
      ctx.fillRect(bx, sy, sw, sh - 3);
      ctx.fillStyle = '#d9b03a';
      ctx.fillRect(bx, sy + sh - 3, sw, 3);
    }

    // Empty: blinking prompt with the reload key.
    if (state === 'empty' && Math.floor(t * 3) % 2 === 0) {
      ctx.font = '10px "Press Start 2P", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const label = reloadKey;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(label, sx, sy + sh + 5);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillText(label, sx, sy + sh + 5);
    }
  }
}
