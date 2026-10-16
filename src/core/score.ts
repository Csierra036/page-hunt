// Score, combo multiplier, stats and difficulty curve.

export const POINTS = {
  damage: 10,
  breakBase: 100,
  duck: 500,
  goldenDuck: 1500,
  bonusDuck: 800,
  perfectReload: 250,
};

/** The game lasts 20 rounds; a boss closes every fifth one. */
export const MAX_ROUND = 20;

/**
 * Progress towards finishing the game (0..1): every round is 1/20, and the current
 * round fills in as its wave is resolved (or its boss loses health).
 */
export function progress(round: number, roundFraction: number) {
  const f = Math.max(0, Math.min(1, roundFraction));
  return Math.max(0, Math.min(1, (Math.min(round, MAX_ROUND) - 1 + f) / MAX_ROUND));
}

export class Score {
  points = 0;
  combo = 0;
  bestCombo = 0;
  shots = 0;
  shotsHit = 0;
  ducksHit = 0;
  ducksEscaped = 0;
  broken = 0;

  get multiplier() {
    return Math.min(8, 1 + Math.floor(this.combo / 4));
  }

  get accuracy() {
    return this.shots ? this.shotsHit / this.shots : 0;
  }

  /** A shot counts as a hit when any pellet damaged an element or a target. */
  registerShot(hit: boolean) {
    this.shots++;
    if (hit) {
      this.shotsHit++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    } else {
      this.combo = 0;
    }
  }

  breakCombo() {
    this.combo = 0;
  }

  /** Adds base points times the current multiplier; returns what was awarded. */
  add(base: number) {
    const awarded = Math.round(base * this.multiplier);
    this.points += awarded;
    return awarded;
  }
}

export interface Difficulty {
  ducks: number;
  /** Duck speed in px/s. */
  speed: number;
  /** Seconds a duck stays before escaping. */
  lifetime: number;
  /** Seconds between spawns inside a wave. */
  interval: number;
  golden: number;
  /** Chance of a bonus duck (releases an extra flock). */
  bonus: number;
}

export function difficulty(round: number): Difficulty {
  const r = Math.max(1, round) - 1;
  return {
    ducks: Math.min(2 + Math.floor(r / 2), 6),
    speed: Math.min(170 + r * 35, 520),
    lifetime: Math.max(7 - r * 0.45, 3.2),
    interval: Math.max(1.6 - r * 0.12, 0.5),
    golden: Math.min(0.06 + r * 0.02, 0.25),
    bonus: Math.min(0.1 + r * 0.01, 0.18),
  };
}
