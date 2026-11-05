import type { BenchCell } from './bench-cell.ts';

/** The position of the cell with these properties among the cells, or -1. */
export function cellIndex(
  cells: readonly BenchCell[],
  form: BenchCell['form'],
  request: BenchCell['request'],
  batching: BenchCell['batching'],
  count: number,
): number {
  return cells.findIndex(
    (cell) =>
      cell.form === form &&
      cell.request === request &&
      cell.batching === batching &&
      cell.count === count,
  );
}
