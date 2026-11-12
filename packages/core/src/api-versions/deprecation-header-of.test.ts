import { describe, expect, test } from 'vitest';
import { deprecationHeaderOf } from './deprecation-header-of.ts';

describe('deprecationHeaderOf', () => {
  test('a calendar date is the seconds of the start of its UTC day', () => {
    expect(deprecationHeaderOf('2026-11-01')).toBe('@1793491200');
  });

  test('an instant with an offset is its own seconds', () => {
    expect(deprecationHeaderOf('2026-11-01T15:30:00Z')).toBe('@1793547000');
    expect(deprecationHeaderOf('2026-11-01T17:30:00+02:00')).toBe('@1793547000');
  });

  test('a text that names no instant gives no header', () => {
    expect(deprecationHeaderOf('2026-11-01T15:30:00')).toBeUndefined();
    expect(deprecationHeaderOf('Dec 1, 2026')).toBeUndefined();
  });
});
