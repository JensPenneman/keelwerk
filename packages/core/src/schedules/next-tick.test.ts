import { describe, expect, test } from 'vitest';
import { nextTick } from './next-tick.ts';

const T0 = Temporal.Instant.from('2026-01-01T00:00:00Z');

describe('the next tick of a schedule', () => {
  test('a tick lies on the epoch grid after the instant', () => {
    expect(nextTick('5m', T0).toString()).toBe('2026-01-01T00:05:00Z');
    expect(nextTick('5m', T0.add({ milliseconds: 1 })).toString()).toBe('2026-01-01T00:05:00Z');
    expect(nextTick('5m', T0.add({ minutes: 5 })).toString()).toBe('2026-01-01T00:10:00Z');
    expect(nextTick('1d', T0.add({ hours: 5 })).toString()).toBe('2026-01-02T00:00:00Z');
  });

  test('an unparsable or zero every is validation', () => {
    expect(() => nextTick('often', T0)).toThrow(expect.objectContaining({ kind: 'validation' }));
    expect(() => nextTick('0s', T0)).toThrow(expect.objectContaining({ kind: 'validation' }));
  });
});
