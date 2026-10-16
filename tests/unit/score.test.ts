import { describe, expect, it } from 'vitest';
import { difficulty, progress, Score } from '../../src/core/score';

describe('Score', () => {
  it('grows the multiplier with consecutive hits and resets on a miss', () => {
    const s = new Score();
    for (let i = 0; i < 8; i++) s.registerShot(true);
    expect(s.multiplier).toBe(3);
    expect(s.add(100)).toBe(300);
    s.registerShot(false);
    expect(s.multiplier).toBe(1);
    expect(s.bestCombo).toBe(8);
    expect(s.accuracy).toBeCloseTo(8 / 9);
  });

  it('caps the multiplier', () => {
    const s = new Score();
    for (let i = 0; i < 100; i++) s.registerShot(true);
    expect(s.multiplier).toBe(8);
  });
});

describe('difficulty', () => {
  it('gets harder every round within limits', () => {
    const a = difficulty(1);
    const b = difficulty(6);
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(b.ducks).toBeGreaterThanOrEqual(a.ducks);
    expect(b.lifetime).toBeLessThan(a.lifetime);
    expect(difficulty(100).speed).toBe(520);
    expect(difficulty(100).ducks).toBe(6);
  });
});

describe('progress towards round 20', () => {
  it('counts finished rounds plus the current one', () => {
    expect(progress(1, 0)).toBe(0);
    expect(progress(1, 0.5)).toBeCloseTo(0.025);
    expect(progress(6, 0)).toBeCloseTo(0.25);
    expect(progress(20, 0.5)).toBeCloseTo(0.975);
    expect(progress(20, 1)).toBe(1);
  });

  it('stays within 0..1', () => {
    expect(progress(25, 3)).toBe(1);
    expect(progress(0, -1)).toBe(0);
  });
});
