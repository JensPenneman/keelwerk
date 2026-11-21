// Entry point: `pnpm --filter @keelwerk/spike-queue-real-handlers measure [quick]` prints the table as Markdown.
import { loadavg } from 'node:os';
import { stdout } from 'node:process';
import { startPostgres } from '@keelwerk/testing/postgres';
import { calibrate } from './calibrate.ts';
import { costProbes } from './cost-probes.ts';
import { kinds } from './kinds.ts';
import type { CellSample } from './measure-cell.ts';
import { measureCell } from './measure-cell.ts';
import type { Row } from './render-rows.ts';
import { renderRows } from './render-rows.ts';

const write = (text: string): void => {
  stdout.write(`${text}\n`);
};

const quick = process.argv.includes('quick');
const batches = [1, 10, 50] as const;
const rounds = quick ? 1 : 3;
const perTenant = quick ? 100 : 500;
const load = (): number => loadavg()[0] ?? Number.NaN;

const postgres = await startPostgres();
try {
  write(`PostgreSQL: ${postgres.version}`);
  write(
    `Mode: ${quick ? 'quick' : 'full'}, ${rounds} round(s), ${perTenant} jobs per tenant, load average (1 minute) at start ${load().toFixed(2)}.\n`,
  );
  const costs = await costProbes(postgres);
  write(
    `Transactions the measurement adds, taken away from every count: monitoring connection ${costs.connect}, poll ${costs.poll}, four workers joining ${costs.joinWork} (${costs.joinReactions} with the reaction dispatcher), four processes joining without workers ${costs.joinCalls}.\n`,
  );
  const samples = new Map<string, CellSample[]>();
  const calibrations: number[] = [];
  const cells = kinds.flatMap((kind) => batches.map((batch) => [kind, batch] as const));
  for (let round = 0; round < rounds; round += 1) {
    // The order of the cells is reversed in every second round.
    for (const [kind, batch] of round % 2 === 0 ? cells : [...cells].reverse()) {
      const sample = await measureCell(postgres, costs, kind, batch, perTenant, load);
      const key = `${kind} ${batch}`;
      samples.set(key, [...(samples.get(key) ?? []), sample]);
    }
    calibrations.push(await calibrate(postgres, costs, perTenant * 8));
  }
  const rows: Row[] = cells.map(([kind, batch]) => ({
    samples: samples.get(`${kind} ${batch}`) ?? [],
    calibrations,
  }));
  write(renderRows(rows));
  write(
    `\nCalibration: ${calibrations.map((rate) => rate.toFixed(0)).join(', ')} transactions per second (one per round). Load average at end ${load().toFixed(2)}.`,
  );
} finally {
  await postgres.stop();
}
