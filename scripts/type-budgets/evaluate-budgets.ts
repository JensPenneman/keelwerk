import type { DeclarationBudget, DeclarationSize } from './check-declaration-sizes.ts';
import { declarationFailures } from './declaration-failures.ts';

interface CountBudget {
  readonly fold: number;
  readonly wholeProgram: number;
}

const count = (value: number): string => value.toLocaleString('en-US');

/** The key of a synthetic row in `budgets.json`: the module count, `+live` with the live module. */
const budgetKeyOf = (row: Pick<SyntheticMeasurement, 'modules' | 'live'>): string =>
  row.live === true ? `${row.modules}+live` : String(row.modules);

/** How a synthetic row is named in the report and the failures. */
const labelOf = (row: Pick<SyntheticMeasurement, 'modules' | 'live'>): string =>
  `synthetic ${row.modules} modules${row.live === true ? ' with live' : ''}`;

/** The counts of one synthetic workspace, the empty workspace's counts already subtracted. */
export interface SyntheticMeasurement {
  readonly modules: number;
  /** Measured with the real live module in the app. */
  readonly live?: true;
  readonly fold: number;
  readonly wholeProgram: number;
  readonly sizes: readonly DeclarationSize[];
  /** Compiler lines with a portability code from `tsc -b` of the workspace. */
  readonly portability: readonly string[];
}

export interface Measurements {
  readonly synthetic: readonly SyntheticMeasurement[];
  /** Instantiations of each recorded app by name, as measured. */
  readonly apps: Readonly<Record<string, number>>;
  /** The declaration sizes of the real module packages and fixture modules. */
  readonly modulePackages: readonly DeclarationSize[];
  /** Compiler lines with a portability code from `tsc -b` of the repository and the module emit. */
  readonly workspacePortability: readonly string[];
}

/** The shape of `budgets.json`. */
export interface Budgets {
  /** Where the figures come from; evaluation never reads it. */
  readonly basis: string;
  readonly synthetic: Readonly<Record<string, CountBudget>>;
  /** The figures the composition-types spike measured, printed beside ours. */
  readonly spike: Readonly<Record<string, CountBudget>>;
  readonly declarations: DeclarationBudget;
  /** Apps at their first green build plus 15 % (S-16). */
  readonly apps: Readonly<
    Record<
      string,
      { readonly include: readonly string[]; readonly recorded: number; readonly budget: number }
    >
  >;
}

export interface Evaluation {
  readonly report: readonly string[];
  readonly failures: readonly string[];
}

/** Compares every measured figure with its budget; the gate fails when `failures` is not empty. */
export function evaluateBudgets(measurements: Measurements, budgets: Budgets): Evaluation {
  const report: string[] = [];
  const failures: string[] = [];
  for (const row of measurements.synthetic) {
    const label = labelOf(row);
    const budget = budgets.synthetic[budgetKeyOf(row)];
    const spike = row.live === true ? undefined : budgets.spike[String(row.modules)];
    const largest = row.sizes.reduce<DeclarationSize | undefined>(
      (best, size) => (best === undefined || size.totalBytes > best.totalBytes ? size : best),
      undefined,
    );
    report.push(
      `${label}: fold ${count(row.fold)}${spike ? ` (spike ${count(spike.fold)})` : ''}${budget ? ` budget ${count(budget.fold)}` : ''}; whole program ${count(row.wholeProgram)}${spike ? ` (spike ${count(spike.wholeProgram)})` : ''}${budget ? ` budget ${count(budget.wholeProgram)}` : ''}; largest package ${largest ? `${largest.totalBytes} B, module.generated.d.ts up to ${Math.max(...row.sizes.map((size) => size.manifestBytes))} B` : '-'}`,
    );
    if (budget) {
      if (row.fold > budget.fold) {
        failures.push(
          `${label}: fold ${count(row.fold)} instantiations, over ${count(budget.fold)}`,
        );
      }
      if (row.wholeProgram > budget.wholeProgram) {
        failures.push(
          `${label}: whole program ${count(row.wholeProgram)} instantiations, over ${count(budget.wholeProgram)}`,
        );
      }
    }
    failures.push(
      ...declarationFailures(
        row.sizes.map((size) => ({ ...size, name: `synthetic ${budgetKeyOf(row)}/${size.name}` })),
        budgets.declarations,
      ),
    );
    for (const line of row.portability) failures.push(`${label}: ${line}`);
  }
  for (const key of Object.keys(budgets.synthetic)) {
    if (!measurements.synthetic.some((row) => budgetKeyOf(row) === key)) {
      failures.push(
        `synthetic ${key.endsWith('+live') ? `${key.slice(0, -5)} modules with live` : `${key} modules`}: no measurement`,
      );
    }
  }
  for (const [name, budget] of Object.entries(budgets.apps)) {
    const measured = measurements.apps[name];
    if (measured === undefined) {
      failures.push(`app ${name}: no measurement`);
      continue;
    }
    report.push(
      `app ${name}: ${count(measured)} instantiations (recorded ${count(budget.recorded)}, budget ${count(budget.budget)})`,
    );
    if (measured > budget.budget) {
      failures.push(`app ${name}: ${count(measured)} instantiations, over ${count(budget.budget)}`);
    }
  }
  for (const size of measurements.modulePackages) {
    report.push(
      `module ${size.name}: ${size.totalBytes} B in total, module.generated.d.ts ${size.manifestBytes} B, largest ${size.largestFile} ${size.largestBytes} B`,
    );
  }
  failures.push(...declarationFailures(measurements.modulePackages, budgets.declarations));
  for (const line of measurements.workspacePortability) failures.push(`workspace: ${line}`);
  return { report, failures };
}
