import { describe, expect, test } from 'vitest';
import { bucketLevel } from './bucket-level.ts';

const at = Temporal.Instant.from('2026-11-19T10:00:00Z');
const limits = { capacity: 10, refillPerSecond: 2 };
const row = (tokens: number, offsetMs: number) => ({
  tokens,
  refilledAt: at.add({ milliseconds: offsetMs }),
});

describe('bucketLevel (S-36)', () => {
  test('a bucket never seen is full and dated at the take', () => {
    expect(bucketLevel(undefined, at, 4, limits)).toEqual({
      available: 10,
      refilledAt: at,
      answer: { ok: true },
    });
    expect(bucketLevel(undefined, at, 11, limits).answer).toEqual({ ok: false, retryAfter: 0.5 });
  });

  test('a row at or behind the take is credited the elapsed time and dated at the take', () => {
    expect(bucketLevel(row(3, 0), at, 1, limits)).toMatchObject({ available: 3, refilledAt: at });
    expect(bucketLevel(row(3, -1000), at, 1, limits)).toMatchObject({
      available: 5,
      refilledAt: at,
    });
  });

  test('the credit is capped at the capacity', () => {
    expect(bucketLevel(row(3, -3_600_000), at, 1, limits).available).toBe(10);
  });

  test('a row ahead by 1 ms to 5,000 ms is credited nothing and keeps its time', () => {
    for (const ahead of [1, 2500, 5000]) {
      const level = bucketLevel(row(3, ahead), at, 1, limits);
      expect(level.available).toBe(3);
      expect(level.refilledAt).toEqual(at.add({ milliseconds: ahead }));
    }
  });

  test('a row ahead by more than 5,000 ms is a clock jump: nothing credited, dated at the take', () => {
    const level = bucketLevel(row(3, 5001), at, 1, limits);
    expect(level.available).toBe(3);
    expect(level.refilledAt).toEqual(at);
    expect(bucketLevel(row(3, 3_600_000), at, 4, limits).answer).toEqual({
      ok: false,
      retryAfter: 0.5,
    });
  });

  test('a refusal on a row kept ahead adds the seconds the row is ahead', () => {
    expect(bucketLevel(row(0, 3000), at, 1, limits).answer).toEqual({
      ok: false,
      retryAfter: 3.5,
    });
    expect(bucketLevel(row(0, 5000), at, 1, limits).answer).toEqual({
      ok: false,
      retryAfter: 5.5,
    });
    expect(bucketLevel(row(0, 5001), at, 1, limits).answer).toEqual({
      ok: false,
      retryAfter: 0.5,
    });
  });

  test('a cost of 0 is always granted and leaves the token count as the level read it', () => {
    expect(bucketLevel(row(0, 3000), at, 0, limits)).toMatchObject({
      available: 0,
      answer: { ok: true },
    });
    expect(bucketLevel(row(0, -500), at, 0, limits).available).toBe(1);
  });
});
