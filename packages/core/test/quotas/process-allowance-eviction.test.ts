import { describe, expect, test } from 'vitest';
import { createProcessAllowance } from '../../src/quotas/create-process-allowance.ts';
import { createHeldTokens } from '../../src/quotas/held-tokens.ts';
import { bucketOf, clockOf } from './allowance-kit.ts';
import { rateFake } from './rate-fake.ts';

/** An entry that holds `tokens`, taken at a fixed time. */
const entry = (tokens: number) => ({
  tokens,
  takenAt: Temporal.Instant.from('2026-11-19T10:00:00Z'),
});

describe('the entries a process holds, by scope (S-143)', () => {
  test('above `most` the entry dropped is the least recently used of the scope that holds the most', () => {
    const held = createHeldTokens(4);
    for (const name of ['a1', 'a2', 'a3']) held.remember('A', name, entry(9));
    held.remember('B', 'b1', entry(9));
    // 5 entries: A holds the most, so its least recently used goes
    held.remember('B', 'b2', entry(9));
    expect([held.get('A', 'a1'), held.get('A', 'a2')].map((found) => found !== undefined)).toEqual([
      false,
      true,
    ]);
    // A is used again: a2 is now its most recently used
    held.remember('A', 'a2', entry(9));
    // B holds 3, A holds 2: B's least recently used goes
    held.remember('B', 'b3', entry(9));
    expect(held.get('B', 'b1')).toBeUndefined();
    expect(held.get('B', 'b2')).toBeDefined();
    expect(held.get('A', 'a3')).toBeDefined();
    // A holds 2, B holds 2, a new scope's first entry: a tie, the scope that reached 2 first goes
    held.remember('C', 'c1', entry(9));
    expect([held.get('A', 'a3'), held.get('A', 'a2')].map((found) => found !== undefined)).toEqual([
      false,
      true,
    ]);
  });

  /** The numbers n of the entries named scope + n that a scope still holds, of `count` given. */
  const keptOf = (held: ReturnType<typeof createHeldTokens>, scope: string, count: number) =>
    Array.from({ length: count }, (_unused, n) => held.get(scope, `${scope}${n}`)).flatMap(
      (found, n) => (found === undefined ? [] : [n]),
    );
  const range = (from: number, length: number) => Array.from({ length }, (_unused, n) => n + from);

  test('a flood cuts a scope only while it holds at least as many entries as the flood, then drops its own', () => {
    const held = createHeldTokens(50);
    for (let n = 0; n < 40; n += 1) held.remember('A', `A${n}`, entry(9));
    for (let n = 0; n < 500; n += 1) held.remember('B', `B${n}`, entry(9));
    // `most` is even: A lost its 15 least recently used entries and holds as many as the flood.
    expect(keptOf(held, 'A', 40)).toEqual(range(15, 25));
    // B holds the same number, its 25 most recently used.
    expect(keptOf(held, 'B', 500)).toEqual(range(475, 25));
  });

  test('when the tie falls on the scope that was there first, it ends one entry below the flood', () => {
    const held = createHeldTokens(51);
    for (let n = 0; n < 40; n += 1) held.remember('A', `A${n}`, entry(9));
    for (let n = 0; n < 500; n += 1) held.remember('B', `B${n}`, entry(9));
    // At 26 and 26 the scope that reached 26 first (A) drops one more; B, the larger, then drops
    // its own.
    expect(keptOf(held, 'A', 40)).toEqual(range(15, 25));
    expect(keptOf(held, 'B', 500)).toEqual(range(474, 26));
  });

  test('a third scope that is below the flood is not cut at all, and the two above it end one apart', () => {
    const held = createHeldTokens(50);
    for (let n = 0; n < 11; n += 1) held.remember('C', `C${n}`, entry(9));
    for (let n = 0; n < 39; n += 1) held.remember('A', `A${n}`, entry(9));
    for (let n = 0; n < 500; n += 1) held.remember('B', `B${n}`, entry(9));
    expect(keptOf(held, 'C', 11)).toEqual(range(0, 11));
    expect(keptOf(held, 'A', 39)).toEqual(range(20, 19));
    expect(keptOf(held, 'B', 500)).toEqual(range(480, 20));
  });

  test('a scope whose last entry was dropped is forgotten', () => {
    const held = createHeldTokens(2);
    held.remember('A', 'a1', entry(1));
    held.remember('B', 'b1', entry(1));
    expect(held.scopesHeld()).toBe(2);
    // A third scope with one entry: a tie of three at size 1, the first scope (A) goes, whole.
    held.remember('C', 'c1', entry(1));
    expect(held.get('A', 'a1')).toBeUndefined();
    expect(held.scopesHeld()).toBe(2);
  });

  test('an entry that is remembered again is not counted twice', () => {
    const held = createHeldTokens(2);
    for (let round = 0; round < 10; round += 1) {
      held.remember('A', 'a', entry(1));
      held.remember('B', 'b', entry(1));
    }
    expect(held.get('A', 'a')).toBeDefined();
    expect(held.get('B', 'b')).toBeDefined();
  });
});

describe('createProcessAllowance with many scopes (S-143, decision 156)', () => {
  const touchTwice = async (
    allowance: ReturnType<typeof createProcessAllowance>,
    fake: ReturnType<typeof rateFake>,
    key: string,
  ) => {
    await allowance.take(fake.target, [bucketOf(key, 100)], false);
    await allowance.take(fake.target, [bucketOf(key, 100)], false);
  };

  test('a flood of fresh buckets from one scope leaves the held tokens of a smaller scope untouched', async () => {
    const quiet = rateFake('ns-quiet');
    const flood = rateFake('ns-flood');
    const allowance = createProcessAllowance({ clock: clockOf(), most: 50 });
    const quietKeys = ['q1', 'q2', 'q3'];
    for (const key of quietKeys) await touchTwice(allowance, quiet, key);
    expect(quiet.units.readWrite).toBe(6);
    const flooded = 500;
    for (let at = 0; at < flooded; at += 1) await touchTwice(allowance, flood, `f${at}`);
    // The quiet scope still serves its 9 held tokens of each bucket without a unit.
    for (const key of quietKeys) {
      for (let i = 0; i < 9; i += 1) {
        expect(await allowance.take(quiet.target, [bucketOf(key, 100)], false)).toBeUndefined();
      }
    }
    expect(quiet.units.readWrite).toBe(6);
    // The flooding scope holds what is left of the 50 entries: the 47 it used last, and only those.
    const unitsBefore = flood.units.readWrite;
    for (let at = flooded - 1; at >= flooded - 47; at -= 1) {
      expect(await allowance.take(flood.target, [bucketOf(`f${at}`, 100)], false)).toBeUndefined();
    }
    expect(flood.units.readWrite).toBe(unitsBefore);
    await allowance.take(flood.target, [bucketOf(`f${flooded - 48}`, 100)], false);
    expect(flood.units.readWrite).toBe(unitsBefore + 1);
  });

  test('many scopes that hold few buckets each hold at most `most` buckets and lose 9 tokens per bucket dropped', async () => {
    const most = 20;
    const allowance = createProcessAllowance({ clock: clockOf(), most });
    const scopes = Array.from({ length: 100 }, (_scope, at) => rateFake(`ns-${at}`));
    const keys = ['x', 'y'];
    for (const fake of scopes) for (const key of keys) await touchTwice(allowance, fake, key);
    // A dry take reads without changing what is held: it opens a unit only for a bucket that is
    // not held with a token.
    let held = 0;
    for (const fake of scopes) {
      for (const key of keys) {
        const reads = fake.units.readOnly;
        await allowance.take(fake.target, [bucketOf(key, 100)], true);
        if (fake.units.readOnly === reads) held += 1;
      }
    }
    expect(held).toBe(most);
    // Every bucket drew 1 + 10 tokens and spent 2; the held ones keep 9 each, the rest lapse.
    const drawn = scopes.reduce(
      (sum, fake) => sum + [...fake.levels.values()].reduce((s, level) => s + (100 - level), 0),
      0,
    );
    const lost = drawn - 2 * 200 - 9 * held;
    expect(lost).toBeLessThanOrEqual(9 * (200 - held));
    expect(lost).toBe(9 * (200 - most));
  });
});
