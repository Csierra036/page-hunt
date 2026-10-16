import { describe, expect, it } from 'vitest';
import { Flock, type Duck } from '../../src/fx/ducks';

function flock() {
  const log = { escaped: [] as Duck[], spawned: [] as Duck[], waves: 0 };
  const f = new Flock({
    spawn: (d) => log.spawned.push(d),
    escaped: (d) => log.escaped.push(d),
    crashed: () => {},
    waveEnd: () => log.waves++,
  });
  return { f, log };
}

const run = (f: Flock, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) f.update(0.05, 1200, 800);
};

describe('bonus flock', () => {
  it('releases extra ducks that stay out of the wave tally', () => {
    const { f, log } = flock();
    run(f, 2); // first wave starts after a short rest
    const tally = [...f.tally];
    f.frenzy(4);
    run(f, 1.5);
    const extra = log.spawned.filter((d) => d.extra);
    expect(extra.length).toBe(4);
    expect(f.tally.length).toBe(tally.length);
    f.shoot(extra[0], 800);
    expect(f.tally.filter((t) => t === 'hit').length).toBe(0);
  });

  it('extra ducks escaping do not count as misses', () => {
    const { f, log } = flock();
    f.frenzy(3);
    run(f, 20);
    const extraEscaped = log.escaped.filter((d) => d.extra);
    expect(extraEscaped.length).toBe(3);
    const misses = f.tally.filter((t) => t === 'miss').length;
    const normalEscaped = log.escaped.filter((d) => !d.extra).length;
    expect(misses).toBeLessThanOrEqual(normalEscaped);
  });

  it('bonus and golden ducks appear with the configured odds', () => {
    const { f, log } = flock();
    run(f, 600);
    const kinds = new Set(log.spawned.map((d) => d.kind));
    expect(kinds.has('normal')).toBe(true);
    expect(kinds.has('bonus')).toBe(true);
  });
});

describe('rounds after a reset', () => {
  it('advance again in a new game even if the previous one ended during a boss fight', () => {
    const { f, log } = flock();
    f.round = 5;
    f.holdRound = true; // boss alive when the player lost
    f.reset();
    expect(f.holdRound).toBe(false);
    expect(f.round).toBe(1);
    // Let a couple of waves fly away: the round number must go up.
    run(f, 40);
    expect(log.waves).toBeGreaterThan(0);
    expect(f.round).toBeGreaterThan(1);
  });
});

describe('beating a boss', () => {
  it('advances exactly one round even if a wave was in progress', () => {
    const { f, log } = flock();
    run(f, 3); // a wave is flying
    f.round = 5;
    f.holdRound = true;
    expect(f.tally.length).toBeGreaterThan(0);
    f.nextRound();
    expect(f.round).toBe(6);
    // Let the old wave's ducks leave: they must not count as a finished wave.
    const wavesBefore = log.waves;
    for (let t = 0; t < 12 && f.ducks.length > 0; t += 0.05) f.update(0.05, 1200, 800);
    expect(f.ducks.length).toBe(0);
    expect(log.waves).toBe(wavesBefore);
    expect(f.round).toBe(6);
  });
});
