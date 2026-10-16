// Weapon crates dropped by ducks (Metal Slug style). They come down slowly on a
// parachute. A bullet cuts the parachute: the crate drops by gravity and the weapon
// is collected when it hits the ground. A crate nobody shoots lands on its own,
// blinks for a moment and disappears.
// "A" crates (only during boss fights) bring an ally duck instead of a weapon, and
// rare heart crates give back a heart.
import { BONUS_IDS, WEAPONS, type BonusId } from '../core/weapon';

export type PickupKind = BonusId | 'ally' | 'heart';

export type PickupState = 'parachute' | 'dropping' | 'landed';

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  vy: number;
  state: PickupState;
  /** Seconds since it landed (unclaimed crates vanish). */
  landedT: number;
  t: number;
}

const SIZE = 26;
const PARACHUTE_SPEED = 55;
const GRAVITY = 1500;
const LANDED_LIFE = 2.5;

export const randomBonus = (): BonusId => BONUS_IDS[Math.floor(Math.random() * BONUS_IDS.length)];

export const BONUS_COLORS: Record<PickupKind, string> = { hmg: '#e8a33d', rocket: '#e0533f', sniper: '#4aa3df', ally: '#3fbf6a', heart: '#f2f0ff' };

const letter = (kind: Exclude<PickupKind, 'heart'>) => (kind === 'ally' ? 'A' : WEAPONS[kind].letter);

/** 7x6 pixel heart, one string per row. */
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

export class Pickups {
  items: Pickup[] = [];
  floor = 800;

  clear() {
    this.items = [];
  }

  spawn(x: number, y: number, kind: PickupKind) {
    this.items.push({ kind, x, y, vy: PARACHUTE_SPEED, state: 'parachute', landedT: 0, t: 0 });
  }

  /** Only crates still hanging from their parachute can be shot. */
  hitTest(x: number, y: number): Pickup | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      if (p.state !== 'parachute') continue;
      // The parachute above the crate counts too.
      if (Math.abs(p.x - x) <= SIZE && y >= p.y - SIZE * 1.8 && y <= p.y + SIZE * 0.8) return p;
    }
    return null;
  }

  /** A bullet cut the parachute: the crate falls. */
  cut(p: Pickup) {
    p.state = 'dropping';
    p.vy = 0;
  }

  /** Advances the crates; returns those that were shot down and just hit the ground. */
  update(dt: number): Pickup[] {
    const collected: Pickup[] = [];
    const ground = this.floor - SIZE / 2 - 4;
    for (const p of this.items) {
      p.t += dt;
      if (p.state === 'landed') {
        p.landedT += dt;
        continue;
      }
      if (p.state === 'dropping') p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y >= ground) {
        p.y = ground;
        if (p.state === 'dropping') collected.push(p);
        else p.state = 'landed';
      }
    }
    this.items = this.items.filter((p) => !collected.includes(p) && p.landedT < LANDED_LIFE);
    return collected;
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.items) {
      if (p.state === 'landed' && Math.floor(p.landedT * 8) % 2 === 0) continue;
      const sway = p.state === 'parachute' ? Math.round(Math.sin(p.t * 2.5) * 4) : 0;
      const x = Math.round(p.x - SIZE / 2) + sway;
      const y = Math.round(p.y - SIZE / 2);
      if (p.state === 'parachute') {
        ctx.fillStyle = '#111';
        ctx.fillRect(x - 8, y - 30, SIZE + 16, 14);
        ctx.fillStyle = '#f2f0ff';
        ctx.fillRect(x - 6, y - 28, SIZE + 12, 10);
        ctx.fillStyle = '#ff5a3c';
        for (let i = 0; i < 3; i++) ctx.fillRect(x - 6 + i * 14, y - 28, 6, 10);
        ctx.fillStyle = '#111';
        ctx.fillRect(x - 4, y - 18, 2, 18);
        ctx.fillRect(x + SIZE + 2, y - 18, 2, 18);
      }
      // Crate: black outline, coloured body, light edge and the weapon letter.
      ctx.fillStyle = '#111';
      ctx.fillRect(x - 2, y - 2, SIZE + 4, SIZE + 4);
      ctx.fillStyle = BONUS_COLORS[p.kind];
      ctx.fillRect(x, y, SIZE, SIZE);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(x, y, SIZE, 3);
      ctx.fillRect(x, y, 3, SIZE);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + SIZE - 3, SIZE, 3);
      if (p.kind === 'heart') {
        const k = 3;
        const ox = x + Math.round((SIZE - 7 * k) / 2);
        const oy = y + Math.round((SIZE - 6 * k) / 2) + 1;
        HEART.forEach((row, j) =>
          [...row].forEach((c, i) => {
            if (c !== 'X') return;
            ctx.fillStyle = j === 1 && (i === 1 || i === 2) ? '#ffb3c1' : '#ff2d55';
            ctx.fillRect(ox + i * k, oy + j * k, k, k);
          }),
        );
        continue;
      }
      ctx.font = '14px "Press Start 2P", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111';
      ctx.fillText(letter(p.kind), x + SIZE / 2 + 1, y + SIZE / 2 + 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(letter(p.kind), x + SIZE / 2, y + SIZE / 2 + 1);
    }
  }
}
