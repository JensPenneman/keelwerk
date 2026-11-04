import { describe, expect, it } from 'vitest';
import { medianRow } from './median-row.ts';

describe('medianRow', () => {
  it('takes the median of numeric columns and the first value of the others', () => {
    const row = medianRow(
      [
        { mode: 'a', 'commits/s': 300, 'p95 ms': 9 },
        { mode: 'b', 'commits/s': 100, 'p95 ms': 3 },
        { mode: 'c', 'commits/s': 200, 'p95 ms': 6 },
      ],
      'commits/s',
    );
    expect(row).toEqual({
      mode: 'a',
      'commits/s': 200,
      'p95 ms': 6,
      'commits/s min-max': '100-300',
      runs: 3,
    });
  });
});
