import { describe, expect, test } from 'vitest';
import type { Carrier } from '../invoker/carrier.ts';
import { flagClientIdOf } from './flag-client-id-of.ts';

const carrierWith = (id?: string): Carrier => ({
  transport: 'test',
  ...(id === undefined ? {} : { headers: { 'keelwerk-client-id': id } }),
});

describe('flagClientIdOf', () => {
  test('accepts 1 to 200 visible ASCII characters', () => {
    expect(flagClientIdOf(carrierWith('c-1'))).toBe('c-1');
    expect(flagClientIdOf(carrierWith('~'.repeat(200)))).toBe('~'.repeat(200));
  });

  test('refuses anything else', () => {
    for (const id of ['', '~'.repeat(201), 'a b', 'a\tb', 'Zo\u00eb']) {
      expect(flagClientIdOf(carrierWith(id))).toBeNull();
    }
    expect(flagClientIdOf(carrierWith())).toBeNull();
  });
});
