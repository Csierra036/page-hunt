import { afterEach, describe, expect, it, vi } from 'vitest';
import { Allies, MAX_ALLIES } from '../../src/fx/allies';
import { Boss, type BossHost } from '../../src/fx/bosses';
import { Particles } from '../../src/fx/particles';

const W = 1200;
const H = 800;

function setup(kind: 'mama' | 'mecha') {
  const host: BossHost = { w: W, h: H, aim: { x: -500, y: -500 }, particles: new Particles(), hurtPlayer: () => {}, frenzy: () => {}, blastPage: () => {} };
  const boss = new Boss(kind, host);
  for (let t = 0; t < 1.7; t += 1 / 60) boss.update(1 / 60); // entrance
  const hits: string[] = [];
  const allies = new Allies((r) => hits.push(r.what), () => {});
  return { boss, allies, hits };
}

const step = (allies: Allies, boss: Boss | null, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    boss?.update(1 / 60);
    allies.update(1 / 60, boss, W, H);
  }
};

describe('ally ducks', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shoot the boss projectiles before the boss', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // always on target
    const { boss, allies, hits } = setup('mama');
    allies.spawn(W, H);
    step(allies, boss, 4);
    expect(allies.shots).toBeGreaterThan(3);
    expect(hits).toContain('projectile');
    expect(hits).toContain('boss');
    expect(boss.hp).toBeLessThan(boss.max);
  });

  it('bounce off Mecha-Pato armour like the player does', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { boss, allies, hits } = setup('mecha');
    allies.spawn(W, H);
    // Patrol phase (core closed). Its rockets would be shot first, so clear them to aim at the body.
    for (let t = 0; t < 1.5; t += 1 / 60) {
      boss.update(1 / 60);
      boss.projectiles = [];
      allies.update(1 / 60, boss, W, H);
    }
    expect(hits.filter((h) => h === 'armor').length).toBeGreaterThan(0);
    expect(boss.hp).toBe(boss.max);
  });

  it('are capped and leave when the boss is gone', () => {
    const { boss, allies } = setup('mama');
    for (let i = 0; i < MAX_ALLIES + 2; i++) allies.spawn(W, H);
    expect(allies.active).toBe(MAX_ALLIES);
    allies.dismiss();
    expect(allies.active).toBe(0);
    step(allies, null, 4);
    expect(allies.list.length).toBe(0);
    expect(boss).toBeTruthy();
  });
});
