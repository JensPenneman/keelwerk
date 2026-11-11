import { describe, expect, test } from 'vitest';
import { splitHash } from './split-hash.ts';

describe('splitHash', () => {
  test('golden vectors fix the stored hash input', () => {
    expect(splitHash('library.newFlow', '6f1c2a4e-0000-4000-8000-000000000001')).toBe(0x6fa12d10);
    expect(splitHash('library.newFlow', 'user-1')).toBe(0xcc9e8bca);
    expect(splitHash('exp:checkout-test:1', 'user-1')).toBe(0xff16c29a);
    expect(splitHash('library.newFlow', 'Zoë')).toBe(0xcfa7bcae);
    expect(0xcc9e8bca).toBe(3_432_942_538);
  });
});
