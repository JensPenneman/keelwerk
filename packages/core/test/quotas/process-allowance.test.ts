import { describe, expect, test } from 'vitest';
import { createProcessAllowance } from '../../src/quotas/create-process-allowance.ts';
import type { RateBucket } from '../../src/quotas/process-allowance.ts';
import { rateFake } from './rate-fake.ts';

function clockOf(): { now: () => Temporal.Instant; advance: (ms: number) => void } {
  let at = Temporal.Instant.from('2026-11-19T10:00:00Z');
  return {
    now: () => at,
    advance: (ms) => {
      at = at.add({ milliseconds: ms });
    },
  };
}

const bucketOf = (key: string, capacity: number): RateBucket => ({
  key,
  limit: { kind: 'rate', capacity, refillPerSecond: 1 },
});

describe('createProcessAllowance (S-143, decision 156)', () => {
  test('the first touch of a bucket takes one token from the shared bucket', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    expect(await allowance.take(fake.target, [bucketOf('a', 100)], false)).toBeUndefined();
    expect(fake.levels.get('a')).toBe(99);
    expect(fake.units.readWrite).toBe(1);
  });

  test('a draw within holdMs takes n and serves the next n - 1 requests without a unit', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const bucket = bucketOf('a', 100);
    await allowance.take(fake.target, [bucket], false);
    await allowance.take(fake.target, [bucket], false);
    expect(fake.levels.get('a')).toBe(89);
    expect(fake.units.readWrite).toBe(2);
    for (let i = 0; i < 9; i += 1) {
      expect(await allowance.take(fake.target, [bucket], false)).toBeUndefined();
    }
    expect(fake.units.readWrite).toBe(2);
    expect(fake.levels.get('a')).toBe(89);
  });

  test('two allowances on one bucket never admit more than capacity + 2(n - 1)', async () => {
    const fake = rateFake();
    const clock = clockOf();
    const first = createProcessAllowance({ clock });
    const second = createProcessAllowance({ clock });
    const bucket = bucketOf('a', 100);
    let admitted = 0;
    for (let i = 0; i < 400; i += 1) {
      const allowance = i % 2 === 0 ? first : second;
      if ((await allowance.take(fake.target, [bucket], false)) === undefined) admitted += 1;
    }
    expect(admitted).toBeLessThanOrEqual(100 + 2 * 9);
    expect(admitted).toBeGreaterThanOrEqual(100 - 2 * 9);
  });

  test('a dropped allowance loses at most n - 1 tokens', async () => {
    const fake = rateFake();
    const clock = clockOf();
    const bucket = bucketOf('a', 100);
    const dropped = createProcessAllowance({ clock });
    await dropped.take(fake.target, [bucket], false);
    await dropped.take(fake.target, [bucket], false);
    const survivor = createProcessAllowance({ clock });
    let admitted = 0;
    while ((await survivor.take(fake.target, [bucket], false)) === undefined) admitted += 1;
    expect(admitted).toBeGreaterThanOrEqual(100 - 2 - 9);
    expect(admitted).toBeLessThanOrEqual(98);
  });

  test('a refused take of n retries with 1 in the same unit', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const bucket = bucketOf('a', 100);
    await allowance.take(fake.target, [bucket], false);
    fake.levels.set('a', 5);
    expect(await allowance.take(fake.target, [bucket], false)).toBeUndefined();
    expect(fake.levels.get('a')).toBe(4);
    expect(fake.units.readWrite).toBe(2);
  });

  test('a refused bucket answers its wait and the other buckets still give their token', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    fake.levels.set('a', 0);
    const wait = await allowance.take(fake.target, [bucketOf('a', 100), bucketOf('b', 100)], false);
    expect(wait).toBe(5);
    expect(fake.levels.get('b')).toBe(99);
    expect(fake.units.readWrite).toBe(1);
  });

  test('held tokens lapse holdMs after their take and the next draw costs 1', async () => {
    const fake = rateFake();
    const clock = clockOf();
    const allowance = createProcessAllowance({ clock, holdMs: 1000 });
    const bucket = bucketOf('a', 100);
    await allowance.take(fake.target, [bucket], false);
    await allowance.take(fake.target, [bucket], false);
    expect(fake.levels.get('a')).toBe(89);
    clock.advance(1000);
    await allowance.take(fake.target, [bucket], false);
    expect(fake.levels.get('a')).toBe(88);
    expect(fake.units.readWrite).toBe(3);
  });

  test('a dry take reads check in a read-only unit and changes nothing', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    expect(await allowance.take(fake.target, [bucketOf('a', 100)], true)).toBeUndefined();
    expect(fake.units).toEqual({ readWrite: 0, readOnly: 1 });
    expect(fake.levels.size).toBe(0);
    fake.levels.set('a', 0);
    expect(await allowance.take(fake.target, [bucketOf('a', 100)], true)).toBe(5);
    expect(fake.levels.get('a')).toBe(0);
  });

  test('at most `most` buckets are held and the least recently used is dropped', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf(), most: 2 });
    const [a, b, c] = [bucketOf('a', 100), bucketOf('b', 100), bucketOf('c', 100)] as [
      RateBucket,
      RateBucket,
      RateBucket,
    ];
    for (const bucket of [a, a, b, b, c, c]) await allowance.take(fake.target, [bucket], false);
    expect(fake.units.readWrite).toBe(6);
    await allowance.take(fake.target, [b], false);
    await allowance.take(fake.target, [c], false);
    expect(fake.units.readWrite).toBe(6);
    await allowance.take(fake.target, [a], false);
    expect(fake.units.readWrite).toBe(7);
  });

  test('a limit with capacity below 1 is refused with wait 1 and opens no unit', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    expect(await allowance.take(fake.target, [bucketOf('a', 0)], false)).toBe(1);
    expect(await allowance.take(fake.target, [bucketOf('a', 0.5)], true)).toBe(1);
    expect(fake.units).toEqual({ readWrite: 0, readOnly: 0 });
  });

  test('concurrent takes on a unit that yields lose at most n - 1 tokens', async () => {
    const fake = rateFake();
    const adapter = fake.target.handle.adapter;
    const open = adapter.unit.bind(adapter);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = false;
    (adapter as { unit: unknown }).unit = async (...args: Parameters<typeof open>) => {
      if (gated) await gate;
      return open(...args);
    };
    const allowance = createProcessAllowance({ clock: clockOf() });
    const bucket = bucketOf('a', 100);
    let admitted = 0;
    if ((await allowance.take(fake.target, [bucket], false)) === undefined) admitted += 1;
    gated = true;
    const burst = Array.from({ length: 10 }, () => allowance.take(fake.target, [bucket], false));
    release();
    for (const wait of await Promise.all(burst)) if (wait === undefined) admitted += 1;
    for (let i = 0; i < 300; i += 1) {
      if ((await allowance.take(fake.target, [bucket], false)) === undefined) admitted += 1;
    }
    expect(admitted).toBeGreaterThanOrEqual(100 - 9);
    expect(admitted).toBeLessThanOrEqual(100);
  });
});
