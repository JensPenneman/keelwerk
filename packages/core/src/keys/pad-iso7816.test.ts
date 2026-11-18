import { describe, expect, it } from 'vitest';
import { padIso7816 } from './pad-iso7816.ts';
import { unpadIso7816 } from './unpad-iso7816.ts';

const bytes = (length: number): Uint8Array => new Uint8Array(length).fill(0x41);

describe('ISO/IEC 7816-4 padding', () => {
  it.each([
    [0, 32],
    [31, 32],
    [32, 64],
    [33, 64],
  ])('pads %i bytes to %i and takes them back', (length, padded) => {
    const out = padIso7816(bytes(length), 32);
    expect(out.length).toBe(padded);
    expect(out[length]).toBe(0x80);
    expect(out.subarray(length + 1).every((byte) => byte === 0)).toBe(true);
    expect(unpadIso7816(out)).toEqual(bytes(length));
  });

  it('refuses a tail of zeros without the 0x80 byte', () => {
    expect(unpadIso7816(new Uint8Array(32))).toBeUndefined();
    expect(unpadIso7816(new Uint8Array([0x41, 0x00, 0x00]))).toBeUndefined();
  });

  it('refuses a non-zero byte after the 0x80 byte', () => {
    expect(unpadIso7816(new Uint8Array([0x41, 0x80, 0x00, 0x01]))).toBeUndefined();
  });

  it('keeps a 0x80 byte inside the plain bytes', () => {
    const plain = new Uint8Array([0x80, 0x41, 0x80]);
    expect(unpadIso7816(padIso7816(plain, 16))).toEqual(plain);
  });
});
