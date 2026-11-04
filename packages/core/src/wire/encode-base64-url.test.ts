import { describe, expect, test } from 'vitest';
import { decodeBase64Url } from '../fields/decode-base64-url.ts';
import { encodeBase64Url } from './encode-base64-url.ts';

describe('encodeBase64Url', () => {
  test('matches the RFC 4648 vectors without padding', () => {
    const encode = (text: string): string => encodeBase64Url(new TextEncoder().encode(text));
    expect([encode(''), encode('f'), encode('fo'), encode('foo'), encode('foob')]).toEqual([
      '',
      'Zg',
      'Zm8',
      'Zm9v',
      'Zm9vYg',
    ]);
  });

  test('uses the url alphabet and round trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const text = encodeBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBase64Url(text)).toEqual(bytes);
    expect(encodeBase64Url(Uint8Array.of(251, 255))).toBe('-_8');
  });
});
