import { describe, expect, test } from 'vitest';
import { deprecatedFrom } from './deprecated-from.ts';

describe('deprecatedFrom', () => {
  test('a bare date has begun on its day and after, not before', () => {
    expect(deprecatedFrom('2026-12-01', '2026-11-30')).toBe(false);
    expect(deprecatedFrom('2026-12-01', '2026-12-01')).toBe(true);
    expect(deprecatedFrom('2026-12-01', '2026-12-02')).toBe(true);
  });

  test('a text with a time counts by its UTC day', () => {
    expect(deprecatedFrom('2026-12-01T00:00:00Z', '2026-12-01')).toBe(true);
    expect(deprecatedFrom('2026-12-01T23:59:59Z', '2026-12-01')).toBe(true);
    expect(deprecatedFrom('2026-12-01T23:59:59Z', '2026-11-30')).toBe(false);
    expect(deprecatedFrom('2026-12-02T01:00:00+05:00', '2026-12-01')).toBe(true);
    expect(deprecatedFrom('2026-12-01T01:00:00-05:00', '2026-12-01')).toBe(true);
    expect(deprecatedFrom('2026-12-01T20:00:00-05:00', '2026-12-01')).toBe(false);
  });

  test('without at it is in force from its declaration', () => {
    expect(deprecatedFrom(undefined, '2026-11-01')).toBe(true);
  });

  test('a time without an offset and any other text have not begun: they are refused where an action is defined', () => {
    expect(deprecatedFrom('2026-12-01T10:00:00', '2026-12-01')).toBe(false);
    expect(deprecatedFrom('Dec 1, 2026', '2027-01-01')).toBe(false);
  });
});
