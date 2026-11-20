import { describe, expect, test } from 'vitest';
import { createProcessAllowance } from '../../src/quotas/create-process-allowance.ts';
import { bucketOf, clockOf } from './allowance-kit.ts';
import { rateFake } from './rate-fake.ts';

describe('createProcessAllowance, a refused request (answer 13)', () => {
  test('every store bucket but the last is locked and checked before any is taken', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    expect(await allowance.take(fake.target, [bucketOf('a', 100), bucketOf('b', 100)], false)).toBe(
      undefined,
    );
    expect(fake.calls).toEqual(['take:a:0', 'check:a:1', 'take:b:1', 'take:a:1']);
  });

  test('a draw that does not fit is checked again with 1 before the bucket is taken', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const buckets = [bucketOf('a', 100), bucketOf('b', 100)];
    await allowance.take(fake.target, buckets, false);
    fake.levels.set('a', 5);
    fake.calls.length = 0;
    expect(await allowance.take(fake.target, buckets, false)).toBeUndefined();
    expect(fake.calls).toEqual(['take:a:0', 'check:a:10', 'check:a:1', 'take:b:10', 'take:a:1']);
    expect(fake.levels.get('a')).toBe(4);
  });

  test('a take that refuses after its check allowed rolls the unit back', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const buckets = [bucketOf('a', 100), bucketOf('b', 100)];
    await allowance.take(fake.target, buckets, false);
    expect([fake.levels.get('a'), fake.levels.get('b')]).toEqual([99, 99]);
    fake.refuseNextTake.add('a');
    expect(await allowance.take(fake.target, buckets, false)).toBe(7);
    expect([fake.levels.get('a'), fake.levels.get('b')]).toEqual([99, 99]);
    // nothing is held: the next request goes to the store and draws
    const units = fake.units.readWrite;
    expect(await allowance.take(fake.target, buckets, false)).toBeUndefined();
    expect(fake.units.readWrite).toBe(units + 1);
    expect([fake.levels.get('a'), fake.levels.get('b')]).toEqual([89, 89]);
  });

  test('a request that a later bucket refuses takes nothing from the store', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const buckets = [bucketOf('principal', 100), bucketOf('class', 100), bucketOf('tenant', 100)];
    fake.levels.set('tenant', 0);
    const waits = await Promise.all(
      Array.from({ length: 1000 }, () => allowance.take(fake.target, buckets, false)),
    );
    expect(waits.every((wait) => wait === 5)).toBe(true);
    expect(fake.levels.get('principal')).toBe(100);
    expect(fake.levels.get('class')).toBe(100);
    fake.levels.set('tenant', 100);
    // the process holds nothing of the two buckets: this request is a first touch, one token each
    expect(await allowance.take(fake.target, buckets, false)).toBeUndefined();
    expect(fake.levels.get('principal')).toBe(99);
    expect(fake.levels.get('class')).toBe(99);
  });

  test.each([10_000, 3_600_000])(
    "held tokens dated after the clock's reading have lapsed (a step back of %i ms)",
    async (back) => {
      const fake = rateFake();
      const clock = clockOf();
      const allowance = createProcessAllowance({ clock, holdMs: 1000 });
      const bucket = bucketOf('a', 100);
      await allowance.take(fake.target, [bucket], false);
      await allowance.take(fake.target, [bucket], false);
      expect(fake.levels.get('a')).toBe(89);
      clock.advance(-back);
      await allowance.take(fake.target, [bucket], false);
      expect(fake.units.readWrite).toBe(3);
      expect(fake.levels.get('a')).toBe(88);
      // the entry is dated from the stepped-back clock, so it heals at once
      clock.advance(1000);
      await allowance.take(fake.target, [bucket], false);
      expect(fake.units.readWrite).toBe(4);
    },
  );

  test("a draw's tokens are dated at the clock's reading when the clock steps back during its unit", async () => {
    const fake = rateFake();
    const clock = clockOf();
    const allowance = createProcessAllowance({ clock, holdMs: 1000 });
    const adapter = fake.target.handle.adapter as unknown as {
      unit: (...args: never[]) => Promise<unknown>;
    };
    const open = adapter.unit.bind(adapter);
    let stepBack = false;
    adapter.unit = async (...args: never[]) => {
      const result = await open(...args);
      if (stepBack) clock.advance(-10_000);
      return result;
    };
    const bucket = bucketOf('a', 100);
    // the first request takes its token; the second finds the bucket fresh and empty and draws
    await allowance.take(fake.target, [bucket], false);
    stepBack = true;
    await allowance.take(fake.target, [bucket], false);
    expect(fake.units.readWrite).toBe(2);
    expect(fake.levels.get('a')).toBe(89);
    // the 9 tokens the draw left are held from the clock's reading, not from the request's start
    expect(await allowance.take(fake.target, [bucket], false)).toBeUndefined();
    expect(fake.units.readWrite).toBe(2);
  });
});
