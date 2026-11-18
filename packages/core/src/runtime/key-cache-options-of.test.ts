import { describe, expect, test } from 'vitest';
import { keyCacheOptionsOf } from './key-cache-options-of.ts';

describe('keyCacheOptionsOf', () => {
  test('without a clock in the options the cache keeps its own monotonic reading', () => {
    expect(keyCacheOptionsOf({}).now).toBeUndefined();
    expect(keyCacheOptionsOf({ keyCache: { ttlMs: 5 } })).toEqual({ ttlMs: 5 });
  });

  test('with a clock the reading is that clock and never runs backward', () => {
    let at = Temporal.Instant.fromEpochMilliseconds(10_000);
    const { now } = keyCacheOptionsOf({ clock: { now: () => at } });
    expect(now?.()).toBe(10_000);
    at = Temporal.Instant.fromEpochMilliseconds(4_000);
    expect(now?.()).toBe(10_000);
    at = Temporal.Instant.fromEpochMilliseconds(12_000);
    expect(now?.()).toBe(12_000);
  });
});
