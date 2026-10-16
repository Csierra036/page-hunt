// Duck Hunt style moving targets, drawn in the game layer above the page.
// They never block the page: shots that miss them go through to the stage,
// and shot ducks crash into the page, damaging it where they land.
// Golden ducks are worth more and always drop a weapon; bonus ducks (pink, blinking)
// release an extra flock that does not count for the wave tally.
import { difficulty, type Difficulty } from '../core/score';

export type DuckState = 'fly' | 'hit' | 'fall' | 'escape' | 'gone';

export interface DuckEvents {
  spawn(d: Duck): void;
  escaped(d: Duck): void;
  /** A shot duck reached its crash point. */
  crashed(d: Duck): void;
  waveEnd(hits: number, total: number): void;
}

const PALETTES = [
  { head: '#1f7a3a', body: '#7a4a24', belly: '#c9a46a', wing: '#5a3519' },
  { head: '#2a4fa8', body: '#5b3f78', belly: '#b9a2d8', wing: '#3c2852' },
  { head: '#a8322a', body: '#3d3d3d', belly: '#bdbdbd', wing: '#262626' },
];
const GOLD = { head: '#f5c542', body: '#d99a1e', belly: '#ffe9a8', wing: '#b37608' };
const BONUS = { head: '#ff5fa2', body: '#f2f0ff', belly: '#ffd1e6', wing: '#ff8cc0' };
const BONUS_ALT = { head: '#ffffff', body: '#ff8cc0', belly: '#ffffff', wing: '#ff5fa2' };

export type DuckKind = 'normal' | 'golden' | 'bonus';

export class Duck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: DuckState = 'fly';
  t = 0;
  stateT = 0;
  turnT = 0;
  rot = 0;
  /** Where a shot duck will crash into the page. */
  crashY = 0;
  readonly r: number;
  readonly palette: typeof GOLD;

  constructor(
    x: number,
    y: number,
    speed: number,
    readonly kind: DuckKind,
    public lifetime: number,
    size: number,
    /** Part of a bonus flock: outside the wave tally, escaping costs nothing. */
    readonly extra = false,
  ) {
    this.x = x;
    this.y = y;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    this.vx = Math.cos(a) * speed;
    this.vy = Math.sin(a) * speed;
    this.r = size;
    this.palette = kind === 'golden' ? GOLD : kind === 'bonus' ? BONUS : PALETTES[Math.floor(Math.random() * PALETTES.length)];
  }

  get golden() {
    return this.kind === 'golden';
  }
}

export class Flock {
  ducks: Duck[] = [];
  round = 1;
  /** Per-duck outcome of the current wave, for the HUD tally. */
  tally: ('pending' | 'hit' | 'miss')[] = [];
  private toSpawn = 0;
  private spawnT = 0;
  private restT = 1.5;
  private diff: Difficulty = difficulty(1);
  private spawned = 0;
  /** While a boss is alive the round number does not advance. */
  holdRound = false;
  /** Bonus flock still to release. */
  private extraToSpawn = 0;
  private extraT = 0;

  constructor(private events: DuckEvents) {}

  reset() {
    this.ducks = [];
    this.round = 1;
    this.tally = [];
    this.toSpawn = 0;
    this.restT = 1.5;
    this.extraToSpawn = 0;
    // A new game must not inherit the hold of a boss fight that was lost or abandoned.
    this.holdRound = false;
  }

  /**
   * Boss beaten: move to the next round now. The wave in progress is closed without
   * counting, so its ducks finishing later cannot advance the round a second time.
   */
  nextRound() {
    this.round++;
    this.holdRound = false;
    this.tally = [];
    this.toSpawn = 0;
    this.spawned = 0;
    this.restT = 2;
  }

  /** Bonus duck shot: release `n` extra ducks in quick succession. */
  frenzy(n: number) {
    this.extraToSpawn += n;
    this.extraT = 0.2;
  }

  private startWave() {
    this.diff = difficulty(this.round);
    this.toSpawn = this.diff.ducks;
    this.spawned = 0;
    this.tally = Array.from({ length: this.diff.ducks }, () => 'pending' as const);
    this.spawnT = 0;
  }

  /** Ducks still flying (shootable). */
  get alive() {
    return this.ducks.filter((d) => d.state === 'fly');
  }

  hitTest(x: number, y: number): Duck | null {
    for (const d of this.ducks) {
      if (d.state === 'fly' && Math.hypot(d.x - x, d.y - y) < d.r * 1.25) return d;
    }
    return null;
  }

  shoot(d: Duck, h: number) {
    d.state = 'hit';
    d.stateT = 0;
    d.crashY = Math.min(h - 20, d.y + 80 + Math.random() * (h - d.y) * 0.6);
    if (d.extra) return;
    const i = this.tally.indexOf('pending');
    if (i >= 0) this.tally[i] = 'hit';
  }

  /** `spawning` is off during the finale: ducks in the air finish their flight, no new waves. */
  update(dt: number, w: number, h: number, spawning = true) {
    const size = Math.max(18, Math.min(30, w / 40));
    if (spawning && this.toSpawn === 0 && this.extraToSpawn === 0 && this.ducks.length === 0) {
      this.restT -= dt;
      if (this.restT <= 0) this.startWave();
    } else if (spawning && this.toSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.diff.interval;
        this.toSpawn--;
        this.spawned++;
        const roll = Math.random();
        const kind: DuckKind = roll < this.diff.golden ? 'golden' : roll < this.diff.golden + this.diff.bonus ? 'bonus' : 'normal';
        const d = new Duck(w * (0.15 + Math.random() * 0.7), h + size, this.diff.speed * (0.85 + Math.random() * 0.3), kind, this.diff.lifetime, size);
        this.ducks.push(d);
        this.events.spawn(d);
      }
    }
    if (spawning && this.extraToSpawn > 0) {
      this.extraT -= dt;
      if (this.extraT <= 0) {
        this.extraT = 0.3;
        this.extraToSpawn--;
        // Bonus flocks are a little slower and stay longer: they are a reward.
        const d = new Duck(w * (0.1 + Math.random() * 0.8), h + size, this.diff.speed * 0.85, 'normal', this.diff.lifetime + 2, size, true);
        this.ducks.push(d);
        this.events.spawn(d);
      }
    }

    for (const d of this.ducks) {
      d.t += dt;
      d.stateT += dt;
      if (d.state === 'fly') {
        d.turnT -= dt;
        if (d.turnT <= 0) {
          d.turnT = 0.6 + Math.random() * 1.4;
          const speed = Math.hypot(d.vx, d.vy);
          const a = Math.atan2(d.vy, d.vx) + (Math.random() - 0.5) * 1.8;
          d.vx = Math.cos(a) * speed;
          d.vy = Math.sin(a) * speed;
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        const m = d.r * 1.5;
        if (d.x < m || d.x > w - m) {
          d.vx = Math.abs(d.vx) * (d.x < m ? 1 : -1);
          d.x = Math.max(m, Math.min(w - m, d.x));
        }
        const top = m;
        const bottom = h * 0.78;
        if ((d.y < top && d.vy < 0) || (d.y > bottom && d.vy > 0 && d.t > 1)) d.vy = -d.vy;
        if (d.t > d.lifetime) {
          d.state = 'escape';
          d.vx *= 0.3;
          d.vy = -Math.max(320, Math.abs(d.vy) * 1.5);
          if (!d.extra) {
            const i = this.tally.indexOf('pending');
            if (i >= 0) this.tally[i] = 'miss';
          }
          this.events.escaped(d);
        }
      } else if (d.state === 'hit') {
        if (d.stateT > 0.35) {
          d.state = 'fall';
          d.vx = 0;
          d.vy = 120;
        }
      } else if (d.state === 'fall') {
        d.vy += 1400 * dt;
        d.y += d.vy * dt;
        d.rot = Math.min(Math.PI / 2, d.rot + dt * 10);
        if (d.y >= d.crashY) {
          d.state = 'gone';
          this.events.crashed(d);
        }
      } else if (d.state === 'escape') {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -d.r * 3) d.state = 'gone';
      }
    }
    this.ducks = this.ducks.filter((d) => d.state !== 'gone');

    if (spawning && this.toSpawn === 0 && this.extraToSpawn === 0 && this.ducks.length === 0 && this.tally.length && this.spawned === this.tally.length) {
      const hits = this.tally.filter((t) => t === 'hit').length;
      this.events.waveEnd(hits, this.tally.length);
      this.spawned = 0;
      if (!this.holdRound) this.round++;
      this.restT = 2;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const d of this.ducks) drawDuck(ctx, d);
  }
}

// ---------- Pixel-art sprites ----------
// Each frame is rasterized once into a tiny canvas (1 px per sprite pixel) from simple
// shapes, outlined in black, and drawn scaled up without smoothing.

export type Palette = typeof GOLD;
export type Frame = 'up' | 'mid' | 'down' | 'hit';

/** Sprite grid size, before the 1 px outline on each side. */
export const SW = 20;
export const SH = 18;
const sprites = new Map<string, HTMLCanvasElement>();

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function inTri(x: number, y: number, a: number[], b: number[], c: number[]) {
  const s = (p: number[], q: number[]) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

export function duckSprite(p: Palette, frame: Frame) {
  const key = `${p.head}${p.body}${frame}`;
  let c = sprites.get(key);
  if (c) return c;
  const grid: (string | null)[][] = Array.from({ length: SH }, () => new Array<string | null>(SW).fill(null));
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let col: string | null = null;
      if (inTri(px, py, [0, 9], [4, 10], [1, 13])) col = p.body; // tail
      if (inEllipse(px, py, 8.5, 11.5, 7, 3.6)) col = py > 12.3 ? p.belly : p.body;
      if (px >= 13 && px <= 16 && py >= 7 && py <= 10) col = p.head; // neck
      if (inEllipse(px, py, 15.5, 6, 3.3, 3)) col = p.head;
      if (py >= 9 && py < 10 && px >= 13 && px <= 16.5) col = '#ffffff'; // collar
      if (px >= 18 && px < 20 && py >= 5.5 && py < 7.5) col = '#f39a1e'; // beak
      // Wing, by frame.
      const wing =
        frame === 'up' || frame === 'hit'
          ? inTri(px, py, [4, 11], [12, 11], [6, 1.5])
          : frame === 'mid'
            ? inEllipse(px, py, 7.5, 10.5, 4.5, 1.6)
            : inTri(px, py, [5, 11], [12, 11], [8, 17.5]);
      if (wing) col = p.wing;
      grid[y][x] = col;
    }
  }
  // Eye: open, or crossed out when hit.
  if (frame === 'hit') {
    grid[4][15] = grid[6][17] = grid[4][17] = grid[6][15] = '#000000';
    grid[5][16] = '#000000';
  } else {
    grid[4][16] = grid[5][16] = '#ffffff';
    grid[4][17] = '#ffffff';
    grid[5][17] = '#000000';
  }
  // Feet only when hit (legs up in the air while falling).
  if (frame === 'hit') grid[15][7] = grid[15][10] = grid[16][7] = grid[16][10] = '#f39a1e';
  c = document.createElement('canvas');
  c.width = SW + 2;
  c.height = SH + 2;
  const ctx = c.getContext('2d')!;
  // Black outline: every empty cell touching a filled one.
  ctx.fillStyle = '#111111';
  for (let y = -1; y <= SH; y++) {
    for (let x = -1; x <= SW; x++) {
      if (grid[y]?.[x]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx])) ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  grid.forEach((row, y) =>
    row.forEach((col, x) => {
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }),
  );
  sprites.set(key, c);
  return c;
}

function drawDuck(ctx: CanvasRenderingContext2D, d: Duck) {
  const frame: Frame =
    d.state === 'hit' || d.state === 'fall' ? 'hit' : (['up', 'mid', 'down', 'mid'] as const)[Math.floor(d.t * 12) % 4];
  const palette = d.kind === 'bonus' && Math.floor(d.t * 8) % 2 === 1 ? BONUS_ALT : d.palette;
  const img = duckSprite(palette, frame);
  // Whole-number scale keeps every sprite pixel square.
  const k = Math.max(2, Math.round((d.r * 2.2) / SW));
  const w = img.width * k;
  const h = img.height * k;
  const facing = d.state === 'fly' || d.state === 'escape' ? (d.vx >= 0 ? 1 : -1) : 1;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(d.x), Math.round(d.y));
  // Falling: flipped upside down in one step, like the NES sprite.
  if (d.state === 'fall') ctx.scale(1, -1);
  ctx.scale(facing, 1);
  if (d.golden && Math.floor(d.t * 8) % 2 === 0) {
    ctx.fillStyle = 'rgba(255,216,77,0.35)';
    ctx.fillRect(-w / 2 - k, -h / 2 - k, w + 2 * k, h + 2 * k);
  }
  ctx.drawImage(img, Math.round(-w / 2), Math.round(-h / 2), w, h);
  ctx.restore();
}
