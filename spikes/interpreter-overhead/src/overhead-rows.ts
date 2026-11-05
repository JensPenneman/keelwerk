import { cellIndex } from './cell-index.ts';
import { loadCounts } from './load-counts.ts';
import { noSummary } from './no-summary.ts';
import type { OverheadSamples } from './overhead-samples.ts';
import { summaryOf } from './summary-of.ts';
import type { SummaryRow } from './summary-row.ts';

/**
 * Overhead over the baseline, computed per round and then summarised: per command (the form's
 * time minus the baseline's at the same count) and per load request (the slope from 0 loads to k
 * loads of the form, minus the baseline's slope). The requests that need no adapter have no
 * baseline: their row is the form's own slope, per request.
 */
export function overheadRows(samples: OverheadSamples): readonly SummaryRow[] {
  const rows: SummaryRow[] = [];
  const per = (compute: (round: readonly number[]) => number) =>
    summaryOf(samples.perRound.map(compute));
  const at = (
    round: readonly number[],
    form: 'baseline' | 'plain' | 'generator',
    request: 'load' | 'newId' | 'flag',
    batching: 'none' | 'unbatched' | 'all',
    count: number,
  ) => round[cellIndex(samples.cells, form, request, batching, count)] ?? Number.NaN;
  const columns = (compute: (count: number) => ReturnType<typeof per>) =>
    loadCounts.map((count) => (count === 0 ? noSummary : compute(count)));
  for (const batching of ['unbatched', 'all'] as const) {
    const name = batching === 'all' ? 'ctx.all' : batching;
    rows.push({
      label: `${name}: per command over baseline`,
      values: loadCounts.map((count) =>
        per(
          (round) =>
            at(round, 'generator', 'load', batching, count) -
            at(round, 'baseline', 'load', 'none', count),
        ),
      ),
    });
    rows.push({
      label: `${name}: per load request over baseline`,
      values: columns((count) =>
        per(
          (round) =>
            (at(round, 'generator', 'load', batching, count) -
              at(round, 'generator', 'load', batching, 0) -
              (at(round, 'baseline', 'load', 'none', count) -
                at(round, 'baseline', 'load', 'none', 0))) /
            count,
        ),
      ),
    });
  }
  rows.push({
    label: 'unbatched minus ctx.all, per load request',
    values: columns((count) =>
      per(
        (round) =>
          (at(round, 'generator', 'load', 'unbatched', count) -
            at(round, 'generator', 'load', 'all', count)) /
          count,
      ),
    ),
  });
  for (const [request, label] of [
    ['newId', 'ctx.newId: per request (no adapter, no baseline)'],
    ['flag', 'flag read: per request (no adapter, no baseline)'],
  ] as const) {
    if (!samples.cells.some((cell) => cell.request === request)) continue;
    rows.push({
      label,
      values: columns((count) =>
        per(
          (round) =>
            (at(round, 'generator', request, 'unbatched', count) -
              at(round, 'generator', request, 'unbatched', 0)) /
            count,
        ),
      ),
    });
  }
  rows.push({
    label: 'plain minus baseline, 0 loads',
    values: [
      per(
        (round) => at(round, 'plain', 'load', 'none', 0) - at(round, 'baseline', 'load', 'none', 0),
      ),
    ],
  });
  rows.push({
    label: 'generator minus plain, 0 loads (never yields)',
    values: [
      per(
        (round) =>
          at(round, 'generator', 'load', 'unbatched', 0) - at(round, 'plain', 'load', 'none', 0),
      ),
    ],
  });
  return rows;
}
