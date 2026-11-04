import { measureCommitTail } from './measure-commit-tail.ts';
import { measureEnvironment } from './measure-environment.ts';
import { measureFairTake } from './measure-fair-take.ts';
import { measureLoadCost } from './measure-load-cost.ts';
import { measureNotifier } from './measure-notifier.ts';
import { measureSnapshotRetries } from './measure-snapshot-retries.ts';
import { measureTenantIsolation } from './measure-tenant-isolation.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { renderResult } from './render-result.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { startPostgres } from './start-postgres.ts';

const measurements: Readonly<
  Record<string, (postgres: RunningPostgres) => Promise<MeasurementResult>>
> = {
  '0': measureEnvironment,
  '1': measureTenantIsolation,
  '2': measureCommitTail,
  '3': measureNotifier,
  '4': measureFairTake,
  '5a': measureLoadCost,
  '5b': measureSnapshotRetries,
};

/**
 * Starts one PostgreSQL 18 container, runs the selected measurements (all when `only` is empty) in
 * order, writes each rendered result as soon as it is ready, and stops the container.
 */
export async function runMeasurements(
  only: readonly string[],
  write: (text: string) => void,
): Promise<readonly MeasurementResult[]> {
  const postgres = await startPostgres();
  try {
    write(`# Write-path measurements\n\n${postgres.version}\n\n`);
    const results: MeasurementResult[] = [];
    for (const [id, measure] of Object.entries(measurements)) {
      if (only.length > 0 && id !== '0' && !only.includes(id)) continue;
      const result = await measure(postgres);
      write(`${renderResult(result)}\n`);
      results.push(result);
    }
    return results;
  } finally {
    await postgres.stop();
  }
}
