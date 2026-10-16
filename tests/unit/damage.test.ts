import { describe, expect, it } from 'vitest';
import { damageStage, distToRect, EdgeBites, falloff, gridShatter, hpForArea, hpForImage, shatter } from '../../src/core/damage';

describe('damage model', () => {
  it('gives bigger elements more hit points, within bounds', () => {
    expect(hpForArea(10, 10)).toBe(2);
    expect(hpForArea(200, 50)).toBeGreaterThan(hpForArea(50, 20));
    expect(hpForArea(5000, 5000)).toBe(24);
  });

  it('makes big images much tougher than small ones', () => {
    expect(hpForImage(40, 40)).toBe(hpForArea(40, 40));
    expect(hpForImage(300, 300)).toBeGreaterThan(2 * hpForArea(300, 300));
    expect(hpForImage(1280, 600)).toBe(120);
    expect(hpForImage(400, 300)).toBeGreaterThan(hpForImage(300, 200));
  });

  it('moves through visual stages as hp drops', () => {
    expect([10, 9, 6, 3, 0].map((hp) => damageStage(hp, 10))).toEqual([0, 1, 2, 3, 4]);
  });

  it('falls off with distance', () => {
    expect(falloff(0, 100)).toBe(1);
    expect(falloff(100, 100)).toBe(0);
    expect(falloff(50, 100)).toBeCloseTo(0.5);
  });

  it('measures distance to a rectangle', () => {
    expect(distToRect(5, 5, 0, 0, 10, 10)).toBe(0);
    expect(distToRect(13, 14, 0, 0, 10, 10)).toBe(5);
  });

  it('shatters a rectangle into triangles that cover it', () => {
    const polys = shatter(100, 40, 30, 20, 8);
    const area = polys.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
    expect(area).toBeCloseTo(4000, 0);
  });
});

describe('pixel damage', () => {
  it('gridShatter covers the rectangle with axis-aligned blocks', () => {
    const polys = gridShatter(120, 30, 12);
    const area = polys.reduce((s, p) => s + (p[2][0] - p[0][0]) * (p[2][1] - p[0][1]), 0);
    expect(area).toBeCloseTo(3600, 5);
    expect(polys.every((p) => p.length === 4)).toBe(true);
  });

  it('EdgeBites bites the nearest edge with a staircase and never past 40%', () => {
    const b = new EdgeBites(100, 40, 4);
    expect(b.bitten).toBe(false);
    b.bite(50, 2, 3, () => 0.9);
    expect(Math.max(...b.top)).toBe(3);
    expect(b.top[12]).toBe(3);
    expect(b.top[11]).toBe(2);
    expect(b.bottom.every((d) => d === 0)).toBe(true);
    for (let i = 0; i < 10; i++) b.bite(50, 2, 9);
    expect(Math.max(...b.top)).toBeLessThanOrEqual(Math.floor(b.rows * 0.4));
    expect(b.removed().length).toBeGreaterThan(0);
  });

  it('EdgeBites polygon is a closed staircase inside the box', () => {
    const b = new EdgeBites(60, 30, 5);
    b.bite(58, 15, 2, () => 0.9);
    const poly = b.polygon();
    expect(poly.every(([x, y]) => x >= 0 && x <= 60 && y >= 0 && y <= 30)).toBe(true);
    // The right edge (x = 60) now has a notch: some of its points moved inwards.
    expect(poly.filter(([x, y]) => x < 60 && x >= 50 && y > 0 && y < 30).length).toBeGreaterThan(0);
    expect(b.right.filter((d) => d > 0).length).toBeGreaterThan(0);
  });
});
