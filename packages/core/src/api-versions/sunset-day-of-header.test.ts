import { describe, expect, test } from 'vitest';
import { sunsetDayOfHeader } from './sunset-day-of-header.ts';
import { sunsetHeaderOf } from './sunset-header-of.ts';

describe('sunsetDayOfHeader', () => {
  test('the header of a sunset date names that date again', () => {
    for (const day of ['2026-12-01', '2026-12-31', '2028-02-28']) {
      expect(sunsetDayOfHeader(sunsetHeaderOf(day) ?? '')).toBe(day);
    }
  });

  test('a header that is not at midnight names its own day', () => {
    expect(sunsetDayOfHeader('Wed, 02 Dec 2026 10:00:00 GMT')).toBe('2026-12-02');
  });

  test('a text that is no HTTP-date names nothing', () => {
    expect(sunsetDayOfHeader('tomorrow')).toBeUndefined();
    expect(sunsetDayOfHeader('Wed, 31 Feb 2026 00:00:00 GMT')).toBeUndefined();
    expect(sunsetDayOfHeader('Wed, 02 Foo 2026 00:00:00 GMT')).toBeUndefined();
  });
});
