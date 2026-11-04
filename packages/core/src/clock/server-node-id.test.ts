import { describe, expect, test } from 'vitest';
import { serverNodeId } from './server-node-id.ts';

describe('serverNodeId', () => {
  test('is s and ten Crockford base32 characters from the first 50 bits', () => {
    expect(serverNodeId(new Uint8Array(7))).toBe('s0000000000');
    expect(serverNodeId(new Uint8Array(7).fill(255))).toBe('szzzzzzzzzz');
    expect(serverNodeId(Uint8Array.of(0x08, 0x62, 0x9c, 0x73, 0xe0, 0x00, 0x00))).toBe(
      's11h9rwz000',
    );
  });

  test('ignores bits beyond the 50th and needs 7 bytes', () => {
    const base = Uint8Array.of(1, 2, 3, 4, 5, 6, 0);
    expect(serverNodeId(base)).toBe(serverNodeId(Uint8Array.of(1, 2, 3, 4, 5, 6, 3, 9, 9)));
    expect(() => serverNodeId(new Uint8Array(6))).toThrow(RangeError);
  });

  test('matches the grammar of a clock node id', () => {
    expect(serverNodeId(globalThis.crypto.getRandomValues(new Uint8Array(8)))).toMatch(
      /^s[0-9a-hjkmnp-tv-z]{10}$/,
    );
  });
});
