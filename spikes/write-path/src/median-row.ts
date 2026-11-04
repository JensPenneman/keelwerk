import type { ResultRow } from './result-row.ts';

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? Number.NaN;
  return ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;
};

/**
 * Folds repeated runs of one configuration into one row: numeric columns take the median over the
 * runs, other columns the first run's value; `range` names a numeric column whose min-max is added.
 */
export function medianRow(runs: readonly ResultRow[], range?: string): ResultRow {
  const row: Record<string, string | number> = {};
  for (const key of Object.keys(runs[0] ?? {})) {
    const values = runs.map((run) => run[key]);
    row[key] = values.every((value): value is number => typeof value === 'number')
      ? median(values)
      : (values[0] ?? '');
  }
  if (range !== undefined) {
    const values = runs.map((run) => Number(run[range]));
    row[`${range} min-max`] = `${Math.min(...values)}-${Math.max(...values)}`;
  }
  row.runs = runs.length;
  return row;
}
