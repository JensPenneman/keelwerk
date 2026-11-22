import { describe, expect, it } from 'vitest';
import { backgroundRetryMs } from './background-retry-ms.ts';

describe('backgroundRetryMs', () => {
  it('doubles from one second to ten and jitters by a fifth either way', () => {
    const at = (random: number) =>
      [1, 2, 3, 4, 5, 6].map((failures) => backgroundRetryMs(failures, () => random));
    expect(at(0)).toEqual([800, 1600, 3200, 6400, 8000, 8000]);
    expect(at(0.5)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
    expect(at(1)).toEqual([1200, 2400, 4800, 9600, 12_000, 12_000]);
  });

  it('treats a count below one as the first failure', () => {
    expect(backgroundRetryMs(0, () => 0.5)).toBe(1000);
  });
});
