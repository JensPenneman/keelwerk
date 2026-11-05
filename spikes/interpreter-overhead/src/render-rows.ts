import { loadCounts } from './load-counts.ts';
import { renderSummary } from './render-summary.ts';
import { renderTable } from './render-table.ts';
import type { SummaryRow } from './summary-row.ts';

/** A table of summaries, one column per number of requests (or one column when a row has one value). */
export function renderRows(first: string, rows: readonly SummaryRow[]): string {
  return renderTable(
    [first, ...loadCounts.map((count) => `${count} requests`)],
    rows.map((row) => [
      row.label,
      ...loadCounts.map((_, index) => renderSummary(row.values[index])),
    ]),
  );
}
