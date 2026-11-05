import { describe, expect, test } from 'vitest';
import { alignSealedValues } from './align-sealed-values.ts';

const envelope = { $kwe: 1, k: 'key-1', n: 'bm9uY2U', c: 'Y2lwaGVy' };
const text = 'kwv1.0192a6c0-0000-7000-8000-000000000001.bm9uY2U.Y2lwaGVy';

describe('aligning a re-decided payload with a recorded one (S-82)', () => {
  test('a recorded envelope or sealed text stands for a re-decided plain value', () => {
    const recorded = { values: { email: envelope, apiKey: text, name: 'Ada' } };
    const redecided = { values: { email: 'ada@example.org', apiKey: 'plain-secret', name: 'Ada' } };
    expect(alignSealedValues(recorded, redecided)).toEqual(recorded);
  });

  test('a value that was sealed and is now absent still differs', () => {
    expect(alignSealedValues({ set: { email: envelope } }, { set: { email: null } })).toEqual({
      set: { email: null },
    });
    expect(alignSealedValues({ set: { email: envelope } }, { set: {} })).toEqual({ set: {} });
  });

  test('plain values are compared as they are, and members the record lacks stay', () => {
    expect(
      alignSealedValues({ a: 1, list: [envelope] }, { a: 2, b: 'x', list: ['v', 'w'] }),
    ).toEqual({
      a: 2,
      b: 'x',
      list: [envelope, 'w'],
    });
  });
});
