// Ammo, fire rate and reload state machine. No DOM: driven by the game loop clock (ms).
//
// The shotgun is the only base weapon and the only one that reloads. Pressing the reload
// key again inside the sweet spot is an "active reload": it finishes instantly and gives
// bonus points; missing it jams the gun and the reload takes longer.
//
// Bonus weapons (Metal Slug style) drop from ducks: limited ammo, no reload, and they
// are thrown away when empty.

export type WeaponId = 'shotgun' | 'hmg' | 'rocket' | 'sniper';
export type BonusId = Exclude<WeaponId, 'shotgun'>;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Letter on the pickup crate. */
  letter: string;
  mag: number;
  pellets: number;
  /** Spread radius in CSS px around the crosshair. */
  spread: number;
  damage: number;
  fireDelay: number;
  /** Keeps firing while the trigger is held. */
  auto: boolean;
  /** Area damage at the impact point (rockets). */
  blast: { radius: number; power: number } | null;
  /** Bonus weapons cannot reload and are discarded when empty. */
  bonus: boolean;
  reloadTime: number;
  /** Active-reload window as a fraction of the reload progress. */
  sweet: [number, number];
}

const base = { auto: false, blast: null, bonus: true, reloadTime: 0, sweet: [0, 0] as [number, number] };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  shotgun: { id: 'shotgun', name: 'Escopeta', letter: '', mag: 6, pellets: 7, spread: 34, damage: 1, fireDelay: 320, auto: false, blast: null, bonus: false, reloadTime: 1500, sweet: [0.45, 0.6] },
  hmg: { ...base, id: 'hmg', name: 'Ametralladora', letter: 'H', mag: 60, pellets: 1, spread: 10, damage: 1.5, fireDelay: 75, auto: true },
  rocket: { ...base, id: 'rocket', name: 'Lanzacohetes', letter: 'R', mag: 6, pellets: 1, spread: 0, damage: 4, fireDelay: 450, blast: { radius: 120, power: 7 } },
  sniper: { ...base, id: 'sniper', name: 'Francotirador', letter: 'S', mag: 8, pellets: 1, spread: 0, damage: 12, fireDelay: 380 },
};

export const BONUS_IDS: BonusId[] = ['hmg', 'rocket', 'sniper'];

export const JAM_PENALTY = 0.6;

export type ActiveResult = 'perfect' | 'jam' | null;

export class Weapon {
  def: WeaponDef;
  ammo: number;
  reloading = false;
  /** Elapsed reload time (ms) and the total, which grows when the gun jams. */
  reloadT = 0;
  reloadTotal = 0;
  activeTried = false;
  jammed = false;
  private lastShot = -Infinity;

  constructor(id: WeaponId) {
    this.def = WEAPONS[id];
    this.ammo = this.def.mag;
  }

  get progress() {
    return this.reloading ? Math.min(1, this.reloadT / this.reloadTotal) : 0;
  }

  /** A bonus weapon that ran dry is thrown away. */
  get spent() {
    return this.def.bonus && this.ammo <= 0;
  }

  canFire(now: number) {
    return !this.reloading && this.ammo > 0 && now - this.lastShot >= this.def.fireDelay;
  }

  /** Spends one shell. Returns false when the trigger does nothing (dry, reloading or cooling down). */
  fire(now: number) {
    if (!this.canFire(now)) return false;
    this.ammo--;
    this.lastShot = now;
    return true;
  }

  /** Picking up another crate of the same bonus weapon adds a full magazine. */
  refill() {
    this.ammo += this.def.mag;
  }

  /** Starts a reload. False for bonus weapons, a full magazine or a reload already running. */
  startReload() {
    if (this.def.bonus || this.reloading || this.ammo >= this.def.mag) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadTotal = this.def.reloadTime;
    this.activeTried = false;
    this.jammed = false;
    return true;
  }

  /** Second press of the reload key while reloading. */
  tryActive(): ActiveResult {
    if (!this.reloading || this.activeTried) return null;
    this.activeTried = true;
    const p = this.progress;
    if (p >= this.def.sweet[0] && p <= this.def.sweet[1]) {
      this.finish();
      return 'perfect';
    }
    this.jammed = true;
    this.reloadTotal = this.def.reloadTime * (1 + JAM_PENALTY);
    return 'jam';
  }

  /** Advances the reload. Returns true on the frame it completes. */
  update(dt: number) {
    if (!this.reloading) return false;
    this.reloadT += dt;
    if (this.reloadT >= this.reloadTotal) {
      this.finish();
      return true;
    }
    return false;
  }

  private finish() {
    this.reloading = false;
    this.reloadT = 0;
    this.ammo = this.def.mag;
  }
}
