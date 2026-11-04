import { describe, expect, it } from 'vitest';
import { summarize } from './summarize.ts';

describe('summarize', () => {
  it('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(summarize(values)).toEqual({
      count: 100,
      mean: 50.5,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
    });
  });

  it('reports NaN for an empty input', () => {
    const summary = summarize([]);
    expect(summary.count).toBe(0);
    expect(summary.p95).toBeNaN();
    expect(summary.max).toBeNaN();
  });
});
