import type { BenchCell } from './bench-cell.ts';
import { cellIndex } from './cell-index.ts';
import { cellLabel } from './cell-label.ts';
import { loadCounts } from './load-counts.ts';
import type { OverheadSamples } from './overhead-samples.ts';
import { summaryOf } from './summary-of.ts';
import type { SummaryRow } from './summary-row.ts';

type RowKind = readonly [BenchCell['form'], BenchCell['request'], BenchCell['batching']];

const kinds: readonly RowKind[] = [
  ['baseline', 'load', 'none'],
  ['plain', 'load', 'none'],
  ['generator', 'load', 'unbatched'],
  ['generator', 'load', 'all'],
  ['generator', 'newId', 'unbatched'],
  ['generator', 'flag', 'unbatched'],
];

/** Microseconds per command of every cell: the median over the rounds and the spread. */
export function commandRows(samples: OverheadSamples): readonly SummaryRow[] {
  return kinds
    .filter(([form, request, batching]) =>
      samples.cells.some(
        (cell) => cell.form === form && cell.request === request && cell.batching === batching,
      ),
    )
    .map(([form, request, batching]) => ({
      label: cellLabel({ form, request, batching, count: 0 }),
      values: loadCounts.map((count) => {
        const at = cellIndex(samples.cells, form, request, batching, count);
        return summaryOf(samples.perRound.map((round) => round[at] ?? Number.NaN));
      }),
    }));
}
