import { describe, expect, test } from 'vitest';
import { sunsetHeaderOf } from './sunset-header-of.ts';

describe('sunsetHeaderOf', () => {
  test('a sunset date is the last day served: the header is 00:00:00 GMT of the next day', () => {
    expect(sunsetHeaderOf('2026-12-01')).toBe('Wed, 02 Dec 2026 00:00:00 GMT');
    expect(sunsetHeaderOf('2026-12-31')).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(sunsetHeaderOf('2028-02-28')).toBe('Tue, 29 Feb 2028 00:00:00 GMT');
  });

  test('a text that carries a time counts by its UTC day', () => {
    expect(sunsetHeaderOf('2027-01-01T00:00:00Z')).toBe('Sat, 02 Jan 2027 00:00:00 GMT');
    expect(sunsetHeaderOf('2027-01-01T23:59:59Z')).toBe('Sat, 02 Jan 2027 00:00:00 GMT');
    expect(sunsetHeaderOf('2027-01-01T23:30:00-05:00')).toBe('Sun, 03 Jan 2027 00:00:00 GMT');
  });

  test('a text that names no instant gives no header', () => {
    expect(sunsetHeaderOf('someday')).toBeUndefined();
    expect(sunsetHeaderOf('2027-01-01T10:00:00')).toBeUndefined();
    expect(sunsetHeaderOf('Dec 1, 2026')).toBeUndefined();
  });
});
