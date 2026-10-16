import { describe, expect, it } from 'vitest';
import { JAM_PENALTY, Weapon, WEAPONS } from '../../src/core/weapon';

describe('Weapon', () => {
  it('spends ammo and respects the fire delay', () => {
    const w = new Weapon('shotgun');
    expect(w.fire(0)).toBe(true);
    expect(w.fire(100)).toBe(false);
    expect(w.fire(400)).toBe(true);
    expect(w.ammo).toBe(WEAPONS.shotgun.mag - 2);
  });

  it('cannot fire when empty', () => {
    const w = new Weapon('shotgun');
    for (let i = 0; i < w.def.mag; i++) w.fire(i * 1000);
    expect(w.ammo).toBe(0);
    expect(w.fire(99_000)).toBe(false);
  });

  it('refuses to reload a full magazine', () => {
    expect(new Weapon('shotgun').startReload()).toBe(false);
  });

  it('reloading blocks firing and refills the magazine', () => {
    const w = new Weapon('shotgun');
    w.fire(0);
    expect(w.startReload()).toBe(true);
    expect(w.fire(10_000)).toBe(false);
    expect(w.startReload()).toBe(false);
    expect(w.update(w.def.reloadTime + 1)).toBe(true);
    expect(w.ammo).toBe(w.def.mag);
    expect(w.fire(20_000)).toBe(true);
  });

  it('active reload inside the sweet spot finishes instantly', () => {
    const w = new Weapon('shotgun');
    w.fire(0);
    w.startReload();
    w.update(w.def.reloadTime * ((w.def.sweet[0] + w.def.sweet[1]) / 2));
    expect(w.tryActive()).toBe('perfect');
    expect(w.reloading).toBe(false);
    expect(w.ammo).toBe(w.def.mag);
  });

  it('active reload outside the sweet spot jams and takes longer', () => {
    const w = new Weapon('shotgun');
    w.fire(0);
    w.startReload();
    w.update(10);
    expect(w.tryActive()).toBe('jam');
    expect(w.tryActive()).toBeNull();
    expect(w.update(w.def.reloadTime)).toBe(false);
    expect(w.update(w.def.reloadTime * JAM_PENALTY)).toBe(true);
  });

  it('bonus weapons never reload and are spent when empty', () => {
    const w = new Weapon('rocket');
    expect(w.def.bonus).toBe(true);
    expect(w.spent).toBe(false);
    w.fire(0);
    expect(w.startReload()).toBe(false);
    for (let i = 1; i < w.def.mag; i++) expect(w.fire(i * 1000)).toBe(true);
    expect(w.ammo).toBe(0);
    expect(w.spent).toBe(true);
    expect(new Weapon('shotgun').spent).toBe(false);
  });

  it('a second crate of the same bonus weapon adds a magazine', () => {
    const w = new Weapon('hmg');
    for (let i = 0; i < 10; i++) w.fire(i * 100);
    w.refill();
    expect(w.ammo).toBe(w.def.mag * 2 - 10);
  });

  it('the machine gun fires much faster than the shotgun', () => {
    expect(WEAPONS.hmg.auto).toBe(true);
    expect(WEAPONS.hmg.fireDelay).toBeLessThan(WEAPONS.shotgun.fireDelay / 3);
  });
});
