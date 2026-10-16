import { describe, expect, it } from 'vitest';
import { Boss, bossForRound, type BossHost } from '../../src/fx/bosses';
import { Particles } from '../../src/fx/particles';

function host(aim = { x: 100, y: 700 }) {
  const log = { hurt: 0, frenzy: 0, blasts: 0 };
  const h: BossHost = {
    w: 1200,
    h: 800,
    aim,
    particles: new Particles(),
    hurtPlayer: () => log.hurt++,
    frenzy: (n) => (log.frenzy += n),
    blastPage: () => log.blasts++,
  };
  return { h, log };
}

const run = (b: Boss, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) b.update(1 / 60);
};

describe('bosses', () => {
  it('appear every 5 rounds up to round 20, four different ones', () => {
    expect([1, 4, 5, 6, 10, 15, 20, 25].map(bossForRound)).toEqual([null, null, 'mama', null, 'hawk', 'mecha', 'king', null]);
  });

  it('look more wounded and get angry as they lose health', () => {
    const { h } = host();
    const b = new Boss('mama', h);
    run(b, 2);
    expect(b.wounds).toBe(0);
    b.shoot(b.x, b.y, b.max * 0.5);
    expect(b.wounds).toBe(2);
    expect(b.enraged).toBe(false);
    b.shoot(b.x, b.y, b.max * 0.3);
    expect(b.enraged).toBe(true);
  });

  it('Mamá Pato: an egg reaching the ground costs a heart and smashes the page; a shot one does not', () => {
    const { h, log } = host({ x: -500, y: -500 });
    const b = new Boss('mama', h);
    run(b, 1.7 + 2.3); // enter, then the first egg
    expect(b.projectiles.length).toBeGreaterThan(0);
    const egg = b.projectiles[0];
    expect(b.shoot(egg.x, egg.y, 1)).toEqual({ what: 'projectile', destroyed: true });
    run(b, 6);
    expect(log.hurt).toBeGreaterThan(0);
    expect(log.blasts).toBe(log.hurt);
  });

  it('Mecha-Pato is armoured until its core vents', () => {
    const { h } = host();
    const b = new Boss('mecha', h);
    run(b, 2);
    expect(b.shoot(b.x, b.y, 10)).toEqual({ what: 'armor' });
    expect(b.hp).toBe(b.max);
    while (!b.coreOpen) b.update(1 / 60);
    const r = b.shoot(b.x, b.y, 10);
    expect(r).toEqual({ what: 'boss', damage: 15 });
  });

  it('Rey Fantasma: decoys absorb shots, only the real one takes damage', () => {
    const { h } = host({ x: -500, y: -500 });
    const b = new Boss('king', h);
    while (b.decoys.length === 0) b.update(1 / 60);
    const d = b.decoys[0];
    expect(b.shoot(d.x, d.y, 5)).toEqual({ what: 'decoy' });
    expect(b.hp).toBe(b.max);
  });

  it('Rey Fantasma: the decoys fire their own orb rings too', () => {
    const { h } = host({ x: -5000, y: -5000 });
    const b = new Boss('king', h);
    while (b.decoys.length === 0) b.update(1 / 60); // first teleport leaves decoys
    const decoys = b.decoys.map((d) => ({ ...d }));
    b.projectiles = [];
    // Run to the ring volley of this float phase.
    while (b.projectiles.length === 0) b.update(1 / 60);
    const fromDecoy = (d: { x: number; y: number }) => b.projectiles.filter((p) => Math.hypot(p.x - d.x, p.y - d.y) < 20).length;
    expect(b.projectiles.length).toBe(8 + decoys.length * 6);
    for (const d of decoys) expect(fromDecoy(d)).toBe(6);
  });

  it('dies after its health runs out', () => {
    const { h } = host();
    const b = new Boss('hawk', h);
    run(b, 2);
    b.blast(b.x, b.y, 50, 1000);
    expect(b.hp).toBe(0);
    run(b, 2);
    expect(b.dead).toBe(true);
  });
});
