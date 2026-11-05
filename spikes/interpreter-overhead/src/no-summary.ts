import type { Summary } from './summary.ts';

/** The summary of a column that has no value. */
export const noSummary: Summary = {
  median: Number.NaN,
  min: Number.NaN,
  max: Number.NaN,
};
