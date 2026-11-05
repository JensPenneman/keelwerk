import type { Summary } from './summary.ts';

/** Median (mean of the middle two for an even count), minimum and maximum. */
export function summaryOf(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? Number.NaN)
      : ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;
  return { median, min: sorted[0] ?? Number.NaN, max: sorted.at(-1) ?? Number.NaN };
}
