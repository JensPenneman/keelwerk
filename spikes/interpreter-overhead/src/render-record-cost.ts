import type { RecordCost } from './record-cost.ts';
import { renderSummary } from './render-summary.ts';
import { renderTable } from './render-table.ts';

/** The decision record's cost per number of loads. */
export function renderRecordCost(costs: readonly RecordCost[]): string {
  return renderTable(
    ['loads', 'build us', 'hash us over an empty record'],
    costs.map((cost) => [String(cost.loads), renderSummary(cost.build), renderSummary(cost.hash)]),
  );
}
