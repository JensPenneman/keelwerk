import { laneCap, tenantNames, workerCount } from './kinds.ts';
import type { CellSample } from './measure-cell.ts';
import { spread, summarise } from './summary.ts';

/** A Markdown table. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** The cells of one kind and batch, one per round, and the calibration of each round (transactions per second). */
export interface Row {
  readonly samples: readonly CellSample[];
  readonly calibrations: readonly number[];
}

/**
 * One row per (kind, batch): the slots of each worker, the most jobs the caps let run at once (four
 * workers with `batch` slots each, but eight lanes of `laneCap`), jobs per second, transactions per
 * job, the bound (the calibration's transactions per second divided by the transactions per job,
 * each the median of its rounds) and the one-minute load at the start of the first round and the
 * end of the last.
 */
export function renderRows(rows: readonly Row[]): string {
  return table(
    [
      'kind',
      'batch',
      'slots',
      'most running',
      'jobs/s',
      'transactions/job',
      'bound jobs/s',
      'load',
    ],
    rows.map(({ samples, calibrations }) => {
      const first = samples[0];
      const last = samples.at(-1);
      if (first === undefined || last === undefined) throw new Error('a row without samples');
      const perJob = summarise(samples.map((sample) => sample.transactionsPerJob));
      const bound = summarise(calibrations).median / perJob.median;
      return [
        first.kind,
        String(first.batch),
        String(first.batch),
        String(Math.min(workerCount * first.batch, tenantNames.length * laneCap)),
        spread(summarise(samples.map((sample) => sample.jobsPerSecond))),
        spread(perJob, 2),
        bound.toFixed(0),
        `${first.loadAtStart.toFixed(2)} to ${last.loadAtEnd.toFixed(2)}`,
      ];
    }),
  );
}
