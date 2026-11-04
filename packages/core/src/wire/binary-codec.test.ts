import { describe, expect, test } from 'vitest';
import { binaryCodec } from './binary-codec.ts';

describe('binaryCodec', () => {
  test('round trips bytes through unpadded base64url', () => {
    const bytes = Uint8Array.of(0, 1, 2, 250, 251, 252, 253, 254, 255);
    const text = binaryCodec.toWire(bytes);
    expect(text).toBe('AAEC-vv8_f7_');
    expect(binaryCodec.fromWire(text)).toEqual(bytes);
  });

  test('refuses padding, other alphabets and non-zero trailing bits', () => {
    for (const text of ['Zg==', 'a+b/', 'A', 'Zh']) {
      expect(binaryCodec.fromWire(text)).toBeUndefined();
    }
  });
});
