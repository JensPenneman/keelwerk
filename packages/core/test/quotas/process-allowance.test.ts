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

const bucketOf = (key: string, capacity: number, refillPerSecond = 1): RateBucket => ({
  key,
  limit: { kind: 'rate', capacity, refillPerSecond },
});

/** `hold()` holds back the next unit the fake's adapter is asked for until the function it returns runs. */
function unitGate(fake: ReturnType<typeof rateFake>): () => () => void {
  const adapter = fake.target.handle.adapter as unknown as { unit: (...args: never[]) => unknown };
  const open = adapter.unit.bind(adapter);
  const gates: Promise<void>[] = [];
  adapter.unit = async (...args: never[]) => {
    const gate = gates.shift();
    if (gate !== undefined) await gate;
    return open(...args);
  };
  return () => {
    let release: () => void = () => undefined;
    gates.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  };
}

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

  test('two allowances on a refilling bucket admit capacity + refill x window within 2(n - 1)', async () => {
    const clock = clockOf();
    const fake = rateFake('ns-1', clock);
    const first = createProcessAllowance({ clock });
    const second = createProcessAllowance({ clock });
    const bucket = bucketOf('a', 100, 10);
    const window = 5000;
    let admitted = 0;
    for (let at = 0; at < window; at += 100) {
      for (let i = 0; i < 10; i += 1) {
        const allowance = i % 2 === 0 ? first : second;
        if ((await allowance.take(fake.target, [bucket], false)) === undefined) admitted += 1;
      }
      clock.advance(100);
    }
    const supply = 100 + 10 * (window / 1000);
    expect(admitted).toBeLessThanOrEqual(supply + 2 * 9);
    expect(admitted).toBeGreaterThanOrEqual(supply - 2 * 9);
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

  test('the first refusal stops the buckets after it and they keep their tokens', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    fake.levels.set('a', 0);
    const buckets = [bucketOf('a', 100), bucketOf('b', 100), bucketOf('c', 100)];
    expect(await allowance.take(fake.target, buckets, false)).toBe(5);
    expect([...fake.levels.keys()]).toEqual(['a']);
    expect(fake.units.readWrite).toBe(1);
  });

  test('the tokens taken before a refusal stay with the process', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    fake.levels.set('b', 0);
    expect(await allowance.take(fake.target, [bucketOf('a', 100), bucketOf('b', 100)], false)).toBe(
      5,
    );
    expect(fake.levels.get('a')).toBe(99);
    expect(await allowance.take(fake.target, [bucketOf('a', 100)], false)).toBeUndefined();
    expect(fake.levels.get('a')).toBe(99);
    expect(fake.units.readWrite).toBe(1);
  });

  test('a held token of a request that is refused later goes back to the process', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const a = bucketOf('a', 100);
    await allowance.take(fake.target, [a], false);
    await allowance.take(fake.target, [a], false);
    expect(fake.levels.get('a')).toBe(89);
    fake.levels.set('b', 0);
    expect(await allowance.take(fake.target, [a, bucketOf('b', 100)], false)).toBe(5);
    expect(fake.levels.get('a')).toBe(89);
    const units = fake.units.readWrite;
    for (let i = 0; i < 9; i += 1) {
      expect(await allowance.take(fake.target, [a], false)).toBeUndefined();
    }
    expect(fake.units.readWrite).toBe(units);
  });

  test('a request takes a held token of a later bucket only when the earlier ones give theirs', async () => {
    const fake = rateFake();
    const allowance = createProcessAllowance({ clock: clockOf() });
    const tenant = bucketOf('t', 100);
    await allowance.take(fake.target, [tenant], false);
    await allowance.take(fake.target, [tenant], false);
    fake.levels.set('p', 0);
    const units = fake.units.readWrite;
    expect(await allowance.take(fake.target, [bucketOf('p', 100), tenant], false)).toBe(5);
    for (let i = 0; i < 9; i += 1) {
      expect(await allowance.take(fake.target, [tenant], false)).toBeUndefined();
    }
    expect(fake.units.readWrite).toBe(units + 1);
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
    const clock = clockOf();
    const hold = unitGate(fake);
    const allowance = createProcessAllowance({ clock });
    const bucket = bucketOf('a', 100);
    let admitted = 0;
    if ((await allowance.take(fake.target, [bucket], false)) === undefined) admitted += 1;
    const releases = Array.from({ length: 10 }, hold);
    const burst = Array.from({ length: 10 }, () => allowance.take(fake.target, [bucket], false));
    for (const release of releases) release();
    for (const wait of await Promise.all(burst)) if (wait === undefined) admitted += 1;
    // The burst ends here: what the process still holds lapses unspent.
    clock.advance(5000);
    for (let i = 0; i < 300; i += 1) {
      if ((await allowance.take(fake.target, [bucket], false)) === undefined) admitted += 1;
    }
    expect(admitted).toBeGreaterThanOrEqual(100 - 9);
    expect(admitted).toBeLessThanOrEqual(100);
  });

  test('tokens a draw leaves stay held when requests that overlap it finish after it', async () => {
    const fake = rateFake();
    const hold = unitGate(fake);
    const allowance = createProcessAllowance({ clock: clockOf() });
    const bucket = bucketOf('a', 100);
    await allowance.take(fake.target, [bucket], false);
    const releases = Array.from({ length: 4 }, hold);
    const burst = Array.from({ length: 4 }, () => allowance.take(fake.target, [bucket], false));
    for (const release of releases) release();
    await Promise.all(burst);
    expect(fake.levels.get('a')).toBe(100 - 1 - 10 - 3);
    const units = fake.units.readWrite;
    for (let i = 0; i < 9; i += 1) {
      expect(await allowance.take(fake.target, [bucket], false)).toBeUndefined();
    }
    expect(fake.units.readWrite).toBe(units);
  });

  test('a request that started earlier and ends later does not move the held tokens back in time', async () => {
    const fake = rateFake();
    const clock = clockOf();
    const hold = unitGate(fake);
    const allowance = createProcessAllowance({ clock, holdMs: 1000 });
    const bucket = bucketOf('a', 100);
    const release = hold();
    const early = allowance.take(fake.target, [bucket], false);
    clock.advance(500);
    await allowance.take(fake.target, [bucket], false);
    for (let i = 0; i < 10; i += 1) await allowance.take(fake.target, [bucket], false);
    expect(fake.levels.get('a')).toBe(100 - 1 - 10);
    clock.advance(400);
    release();
    await early;
    expect(fake.levels.get('a')).toBe(100 - 1 - 10 - 1);
    // 950 ms after the later draw, 1,450 ms after the earlier request: the entry is still fresh
    clock.advance(550);
    await allowance.take(fake.target, [bucket], false);
    expect(fake.levels.get('a')).toBe(100 - 1 - 10 - 1 - 10);
  });

  test('tokens drawn while an entry lapsed during the unit are dated from their request and lapse', async () => {
    const fake = rateFake();
    const clock = clockOf();
    const hold = unitGate(fake);
    const allowance = createProcessAllowance({ clock, holdMs: 1000 });
    const bucket = bucketOf('a', 100);
    await allowance.take(fake.target, [bucket], false);
    const release = hold();
    const slow = allowance.take(fake.target, [bucket], false);
    clock.advance(2500);
    release();
    await slow;
    expect(fake.levels.get('a')).toBe(100 - 1 - 10);
    const units = fake.units.readWrite;
    await allowance.take(fake.target, [bucket], false);
    expect(fake.units.readWrite).toBe(units + 1);
    expect(fake.levels.get('a')).toBe(100 - 1 - 10 - 1);
  });
});
