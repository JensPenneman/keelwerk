import { describe, expect, it } from 'vitest';
import { sealedKeyIds } from './sealed-key-ids.ts';

const envelope = (k: string, version: 1 | 2 = 2) => ({ $kwe: version, k, n: 'AAAA', c: 'AAAA' });

describe('the key ids of the envelopes in a value', () => {
  it('finds envelopes of version 1 and 2 in nested objects and lists, each id once, in first-seen order', () => {
    const value = {
      values: { email: envelope('key-b'), nested: { notes: envelope('key-a', 1) } },
      list: [envelope('key-c'), [envelope('key-b')]],
      plain: 'text',
    };
    expect(sealedKeyIds(value)).toEqual(['key-b', 'key-a', 'key-c']);
  });

  it('answers nothing for a value without an envelope', () => {
    expect(sealedKeyIds({ a: 1, b: [null, 'x'] })).toEqual([]);
    expect(sealedKeyIds(null)).toEqual([]);
    expect(sealedKeyIds(undefined)).toEqual([]);
    expect(sealedKeyIds({ $kwe: 3, k: 'key-a', n: 'AAAA', c: 'AAAA' })).toEqual([]);
  });
});
