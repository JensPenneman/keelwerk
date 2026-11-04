import { expect, test } from 'vitest';
import { identityCodec } from './identity-codec.ts';

test('the identity codec returns what it gets', () => {
  const value = { a: 1 };
  expect(identityCodec.encode(value)).toBe(value);
  expect(identityCodec.decode(value)).toBe(value);
});
