import { describe, expect, test } from 'vitest';
import { findPlaintext } from '../src/index.ts';

const hex = (text: string): string => `\\x${Buffer.from(text, 'utf8').toString('hex')}`;

describe('findPlaintext', () => {
  test('finds a marker in text, ignoring case', () => {
    expect(findPlaintext('{"email":"Dump.Marker@Example.org"}', ['dump.marker'])).toEqual([
      'dump.marker',
    ]);
  });

  test('finds a marker inside a hex-escaped bytea and in base64url, in UTF-8 and UTF-16', () => {
    const dump = [
      `(1,"${hex('xx-needle-one-xx')}")`,
      `(2,"${Buffer.from('xx-needle-two-xx', 'utf8').toString('base64url')}")`,
      `(3,"${Buffer.from('xx-needle-three-xx', 'utf16le').toString('base64')}")`,
    ].join('\n');
    expect(
      findPlaintext(dump, ['needle-one', 'needle-two', 'needle-three', 'needle-four']),
    ).toEqual(['needle-one', 'needle-two', 'needle-three']);
  });

  test('random ciphertext shows no marker', () => {
    const noise = `(1,"\\x${Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256)).toString('hex')}")`;
    expect(findPlaintext(noise, ['jenspenneman', 'secret'])).toEqual([]);
  });
});
