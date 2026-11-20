import { describe, expect, test } from 'vitest';
import { nextSessionCheckAt } from '../src/next-session-check-at.ts';

const now = Temporal.Instant.from('2026-11-19T10:00:00Z');

describe('nextSessionCheckAt', () => {
  test('the periodic check', () => {
    expect(nextSessionCheckAt(now, 60_000, undefined).toString()).toBe('2026-11-19T10:01:00Z');
    expect(
      nextSessionCheckAt(now, 60_000, Temporal.Instant.from('2026-11-19T11:00:00Z')).toString(),
    ).toBe('2026-11-19T10:01:00Z');
  });

  test('an earlier expiry wins', () => {
    expect(
      nextSessionCheckAt(now, 60_000, Temporal.Instant.from('2026-11-19T10:00:10Z')).toString(),
    ).toBe('2026-11-19T10:00:10Z');
  });

  test('never sooner than a second', () => {
    expect(
      nextSessionCheckAt(now, 60_000, Temporal.Instant.from('2026-11-19T09:00:00Z')).toString(),
    ).toBe('2026-11-19T10:00:01Z');
    expect(nextSessionCheckAt(now, 0, undefined).toString()).toBe('2026-11-19T10:00:01Z');
  });
});
