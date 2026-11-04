import { describe, expect, test } from 'vitest';
import { wideIntegerCodec } from './wide-integer-codec.ts';

describe('wideIntegerCodec', () => {
  test('keeps the largest safe integer and what lies beyond it', () => {
    const safe = BigInt(Number.MAX_SAFE_INTEGER);
    expect(wideIntegerCodec.toWire(safe)).toBe('9007199254740991');
    expect(wideIntegerCodec.toWire(safe + 2n)).toBe('9007199254740993');
    expect(wideIntegerCodec.fromWire('9007199254740993')).toBe(safe + 2n);
  });

  test('covers exactly the 64-bit range', () => {
    expect(wideIntegerCodec.fromWire('9223372036854775807')).toBe(2n ** 63n - 1n);
    expect(wideIntegerCodec.fromWire('-9223372036854775808')).toBe(-(2n ** 63n));
    expect(wideIntegerCodec.fromWire('9223372036854775808')).toBeUndefined();
    expect(wideIntegerCodec.fromWire('-9223372036854775809')).toBeUndefined();
    expect(() => wideIntegerCodec.toWire(2n ** 63n)).toThrow(RangeError);
  });

  test('refuses text that is not an integer', () => {
    for (const text of ['', '1.5', '1e3', ' 1', '+1', '0x10']) {
      expect(wideIntegerCodec.fromWire(text)).toBeUndefined();
    }
  });
});
