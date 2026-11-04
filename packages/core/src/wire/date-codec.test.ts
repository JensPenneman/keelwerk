import { describe, expect, test } from 'vitest';
import { dateCodec } from './date-codec.ts';

describe('dateCodec', () => {
  test('round trips YYYY-MM-DD', () => {
    const date = Temporal.PlainDate.from('2024-02-29');
    expect(dateCodec.toWire(date)).toBe('2024-02-29');
    expect(dateCodec.fromWire('2024-02-29')?.equals(date)).toBe(true);
  });

  test('refuses malformed and impossible dates', () => {
    for (const text of ['2023-02-29', '2026-1-5', '2026-11-05T00:00:00Z', '', '2026-13-01']) {
      expect(dateCodec.fromWire(text)).toBeUndefined();
    }
  });
});
