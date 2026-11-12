// The type budgets gate of architecture 13.11 and 13.8 step 8: `pnpm budgets`. It builds the
// synthetic workspaces in a temporary directory, measures them and the recorded apps, prints every
// count and exits 1 when one breaks its budget. `--measurements <file>` judges a measurements file
// instead of measuring, which is how the gate itself is tested.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkEmitErrors } from './check-emit-errors.ts';
import { emitModuleDeclarations } from './emit-module-declarations.ts';
import { type Budgets, evaluateBudgets, type Measurements } from './evaluate-budgets.ts';
import { measureInstantiations } from './measure-instantiations.ts';
import { measureProgram } from './measure-program.ts';
import { runTsc } from './run-tsc.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const COUNTS: readonly number[] = [3, 12, 25, 40];

function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function measure(budgets: Budgets, scratch: string): Measurements {
  const core = runTsc(repo, ['-b', 'packages/core'], repo);
  if (/\berror TS\d+:/.test(core)) throw new Error(`packages/core does not build:\n${core}`);
  const modules = emitModuleDeclarations(repo, scratch);
  const workspace = runTsc(repo, ['-b'], repo);
  return {
    synthetic: [
      ...measureInstantiations(COUNTS, repo, scratch),
      ...measureInstantiations([25], repo, scratch, { live: true }),
    ],
    apps: Object.fromEntries(
      Object.entries(budgets.apps).map(([name, app]) => [
        name,
        measureProgram(repo, app.include, scratch),
      ]),
    ),
    modulePackages: modules.sizes,
    workspacePortability: [...checkEmitErrors(workspace), ...modules.portability],
  };
}

const budgets = read<Budgets>(join(import.meta.dirname, 'budgets.json'));
const flag = process.argv.indexOf('--measurements');
const given = flag >= 0 ? process.argv[flag + 1] : undefined;
const scratch = mkdtempSync(join(tmpdir(), 'keelwerk-budgets-'));
try {
  const measurements = given === undefined ? measure(budgets, scratch) : read<Measurements>(given);
  const { report, failures } = evaluateBudgets(measurements, budgets);
  process.stdout.write(`${report.join('\n')}\n`);
  if (failures.length > 0) {
    process.stderr.write(
      `type budgets broken:\n${failures.map((line) => `  ${line}`).join('\n')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('type budgets hold\n');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
