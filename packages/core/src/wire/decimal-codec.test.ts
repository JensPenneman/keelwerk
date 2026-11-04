import { describe, expect, test } from 'vitest';
import { decimalCodec } from './decimal-codec.ts';

describe('decimalCodec', () => {
  test('keeps the scale of the fraction', () => {
    expect(decimalCodec.toWire('12.50')).toBe('12.50');
    expect(decimalCodec.toWire('0.000')).toBe('0.000');
    expect(decimalCodec.fromWire('123456789012345678901234567890.123456789')).toBe(
      '123456789012345678901234567890.123456789',
    );
  });

  test('canonicalises leading zeros and the sign of zero', () => {
    expect(decimalCodec.fromWire('007.10')).toBe('7.10');
    expect(decimalCodec.fromWire('-0.00')).toBe('0.00');
    expect(decimalCodec.fromWire('-00012')).toBe('-12');
  });

  test('refuses what is not a decimal', () => {
    for (const text of ['', '1.', '.5', '1e3', '--1', '1,5']) {
      expect(decimalCodec.fromWire(text)).toBeUndefined();
    }
    expect(() => decimalCodec.toWire('abc')).toThrow(TypeError);
  });
});
