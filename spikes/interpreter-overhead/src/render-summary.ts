import type { Summary } from './summary.ts';

/** A summary as `median (min to max)` in one decimal, or nothing for a column without a value. */
export function renderSummary(summary: Summary | undefined): string {
  if (summary === undefined || Number.isNaN(summary.median)) return '';
  return `${summary.median.toFixed(1)} (${summary.min.toFixed(1)} to ${summary.max.toFixed(1)})`;
}
