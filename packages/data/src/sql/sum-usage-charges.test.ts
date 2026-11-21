import { describe, expect, test } from 'vitest';
import { sumUsageCharges } from './sum-usage-charges.ts';

describe('sumUsageCharges', () => {
  test('sums per dimension, keeps the smallest limit, drops net zero, sorts by dimension', () => {
    expect(
      sumUsageCharges([
        { dimension: 'core.rows', delta: 2n, limit: 10n },
        { dimension: 'a.b', delta: 5n, limit: null },
        { dimension: 'core.rows', delta: 3n, limit: 4n },
        { dimension: 'core.rows', delta: 1n, limit: null },
        { dimension: 'x', delta: 2n, limit: 7n },
        { dimension: 'x', delta: -2n, limit: 1n },
      ]),
    ).toEqual([
      { dimension: 'a.b', delta: 5n, limit: null },
      { dimension: 'core.rows', delta: 6n, limit: 4n },
    ]);
  });
});
