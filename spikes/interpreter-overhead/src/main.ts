// Entry point: `pnpm --filter @keelwerk/spike-interpreter-overhead measure` prints the tables as Markdown.
import { stdout } from 'node:process';
import { benchCells } from './bench-cells.ts';
import { commandRows } from './command-rows.ts';
import { measureOverhead } from './measure-overhead.ts';
import { measureRecordCost } from './measure-record-cost.ts';
import { measureStatements } from './measure-statements.ts';
import { overheadRows } from './overhead-rows.ts';
import { renderRecordCost } from './render-record-cost.ts';
import { renderRows } from './render-rows.ts';
import { renderStatements } from './render-statements.ts';
import { startBenchWorld } from './start-bench-world.ts';
import { startMeasuredPostgres } from './start-measured-postgres.ts';
import { startPostgresWorld } from './start-postgres-world.ts';

const write = (text: string): void => {
  stdout.write(`${text}\n`);
};

const iterations = { memory: 1000, postgres: 400 } as const;
const rounds = 3;
const statementCommands = 200;

write('Values are the median over three alternating rounds in microseconds, with (min to max).\n');
const postgres = await startMeasuredPostgres();
try {
  write(`PostgreSQL: ${postgres.version}\n`);
  for (const target of ['memory', 'postgres'] as const) {
    const samples = await measureOverhead(
      () => (target === 'memory' ? startBenchWorld() : startPostgresWorld(postgres)),
      benchCells(target),
      { iterations: iterations[target], warmup: Math.ceil(iterations[target] / 5), rounds },
    );
    write(`### ${target}: microseconds per command\n`);
    write(`${renderRows('form', commandRows(samples))}\n`);
    write(`### ${target}: overhead over the imperative baseline\n`);
    write(`${renderRows('overhead', overheadRows(samples))}\n`);
  }
  const profiles = [];
  for (const [form, batching, count] of [
    ['baseline', 'none', 0],
    ['baseline', 'none', 20],
    ['generator', 'unbatched', 0],
    ['generator', 'unbatched', 20],
    ['generator', 'all', 20],
  ] as const) {
    profiles.push(
      await measureStatements(
        postgres,
        { form, request: 'load', batching, count },
        statementCommands,
      ),
    );
  }
  write(
    `### postgres: statements per command (pg_stat_statements, ${statementCommands} commands each)\n`,
  );
  write(`${renderStatements(profiles)}\n`);
} finally {
  await postgres.stop();
}
write('### Decision record: microseconds per decision\n');
write(renderRecordCost(measureRecordCost(20_000, rounds)));
