import { describe, expect, test } from 'vitest';
import { instantCodec } from './instant-codec.ts';

describe('instantCodec', () => {
  test('writes UTC with Z at millisecond precision, finer digits rounded down', () => {
    expect(instantCodec.toWire(Temporal.Instant.from('2026-11-05T10:00:00Z'))).toBe(
      '2026-11-05T10:00:00.000Z',
    );
    expect(instantCodec.toWire(Temporal.Instant.from('2026-01-01T00:00:00.123987654Z'))).toBe(
      '2026-01-01T00:00:00.123Z',
    );
  });

  test('reads Z, offsets and lower-case separators to the same instant', () => {
    const expected = Temporal.Instant.from('2026-11-05T09:00:00.500Z');
    expect(instantCodec.fromWire('2026-11-05T10:00:00.5+01:00')?.equals(expected)).toBe(true);
    expect(instantCodec.fromWire('2026-11-05t09:00:00.5000009z')?.equals(expected)).toBe(true);
  });

  test('round trips', () => {
    const instant = Temporal.Instant.from('1969-12-31T23:59:59.999Z');
    expect(instantCodec.fromWire(instantCodec.toWire(instant))?.equals(instant)).toBe(true);
  });

  test('refuses what is not RFC 3339', () => {
    for (const text of ['', '2026-11-05', '2026-11-05T10:00:00', '2026-13-45T10:00:00Z', 'now']) {
      expect(instantCodec.fromWire(text)).toBeUndefined();
    }
  });
});
