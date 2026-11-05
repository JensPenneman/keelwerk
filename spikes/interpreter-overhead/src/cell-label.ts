import type { BenchCell } from './bench-cell.ts';

/** The cell's label in the tables. */
export function cellLabel(cell: BenchCell): string {
  if (cell.form !== 'generator') return cell.form;
  if (cell.request === 'newId') return 'generator ctx.newId';
  if (cell.request === 'flag') return 'generator flag read';
  return cell.batching === 'all' ? 'generator ctx.all' : 'generator unbatched';
}
