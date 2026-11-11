import { describe, expect, test } from 'vitest';
import { scheduleJitter } from './schedule-jitter.ts';

const tick = Temporal.Instant.from('2026-01-01T00:05:00Z');
const a1 = '00000000-0000-4000-8000-0000000000a1';
const a2 = '00000000-0000-4000-8000-0000000000a2';

describe('the jitter of a tick', () => {
  test('no jitter is 0', () => {
    expect(scheduleJitter('ticker.everyTenant', a1, tick, undefined)).toBe(0);
  });

  test('the delay is fixed for its inputs and within the bound', () => {
    const first = scheduleJitter('ticker.everyTenant', a1, tick, '30s');
    const second = scheduleJitter('ticker.everyTenant', a2, tick, '30s');
    expect(first).toBe(scheduleJitter('ticker.everyTenant', a1, tick, '30s'));
    expect([first, second]).toEqual([17_222, 19_499]);
    for (const delay of [first, second]) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });
});
