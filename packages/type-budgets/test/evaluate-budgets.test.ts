import { expect, test } from 'vitest';
import { checkEmitErrors } from '../../../scripts/type-budgets/check-emit-errors.ts';
import {
  type Budgets,
  evaluateBudgets,
  type Measurements,
} from '../../../scripts/type-budgets/evaluate-budgets.ts';
import { portabilityCodes } from '../../../scripts/type-budgets/portability-codes.ts';

const budgets: Budgets = {
  basis: 'test',
  synthetic: { '25': { fold: 450000, wholeProgram: 1550000 } },
  spike: { '25': { fold: 391842, wholeProgram: 1334636 } },
  declarations: { manifestBytes: 6144, packageBytes: 16384, exempt: [] },
  apps: { conformance: { include: ['app.ts'], recorded: 100, budget: 115 } },
};

const size = (name: string, manifestBytes: number, totalBytes: number) => ({
  name,
  manifestBytes,
  totalBytes,
  largestFile: 'module.generated.d.ts',
  largestBytes: manifestBytes,
});

const within: Measurements = {
  synthetic: [
    {
      modules: 25,
      fold: 400000,
      wholeProgram: 1500000,
      sizes: [size('m01', 2880, 12317)],
      portability: [],
    },
  ],
  apps: { conformance: 110 },
  modulePackages: [size('packages/module-accounts', 3249, 9717)],
  workspacePortability: [],
};

test('a run within every budget has no failures and reports each count', () => {
  const { failures, report } = evaluateBudgets(within, budgets);
  expect(failures).toEqual([]);
  expect(report.join('\n')).toContain('fold 400,000 (spike 391,842)');
});

test('an injected over-budget count fails', () => {
  const [row] = within.synthetic;
  if (row === undefined) throw new Error('fixture');
  const { failures } = evaluateBudgets(
    { ...within, synthetic: [{ ...row, fold: 450001, wholeProgram: 1550001 }] },
    budgets,
  );
  expect(failures).toHaveLength(2);
  expect(failures[0]).toContain('fold 450,001');
  expect(failures[1]).toContain('whole program 1,550,001');
});

test('an app over its recorded budget, or not measured, fails', () => {
  expect(evaluateBudgets({ ...within, apps: { conformance: 116 } }, budgets).failures).toHaveLength(
    1,
  );
  expect(evaluateBudgets({ ...within, apps: {} }, budgets).failures).toEqual([
    'app conformance: no measurement',
  ]);
});

test('declaration sizes over either limit fail', () => {
  const { failures } = evaluateBudgets(
    { ...within, modulePackages: [size('packages/module-auth', 6145, 16385)] },
    budgets,
  );
  expect(failures).toHaveLength(2);
});

test('each portability code fails, in a synthetic build and in the workspace', () => {
  for (const code of portabilityCodes) {
    const line = `packages/m01/src/base.ts(3,14): error ${code}: emit failed`;
    expect(checkEmitErrors(`${line}\nunrelated error TS2304: not found`)).toEqual([line]);
    const [row] = within.synthetic;
    if (row === undefined) throw new Error('fixture');
    expect(
      evaluateBudgets({ ...within, workspacePortability: [line] }, budgets).failures,
    ).toHaveLength(1);
    expect(
      evaluateBudgets({ ...within, synthetic: [{ ...row, portability: [line] }] }, budgets)
        .failures,
    ).toHaveLength(1);
  }
  expect(portabilityCodes).toEqual(['TS7056', 'TS2742', 'TS4023', 'TS2883']);
});

test('a budgeted module count without a measurement fails', () => {
  const two: Budgets = {
    ...budgets,
    synthetic: { ...budgets.synthetic, '40': { fold: 960000, wholeProgram: 2600000 } },
  };
  expect(evaluateBudgets(within, two).failures).toEqual(['synthetic 40 modules: no measurement']);
});

test('a package override replaces the default limit of that package alone', () => {
  const overridden: Budgets = {
    ...budgets,
    declarations: {
      ...budgets.declarations,
      overrides: { 'packages/big': { packageBytes: 30000, reason: 'test' } },
    },
  };
  const measured: Measurements = {
    ...within,
    modulePackages: [size('packages/big', 3000, 25000), size('packages/other', 3000, 25000)],
  };
  expect(evaluateBudgets(measured, overridden).failures).toEqual([
    'packages/other: declarations total 25000 B, over 16384 B',
  ]);
});

test('a live row is judged by its 25+live budget', () => {
  const withLive: Budgets = {
    ...budgets,
    synthetic: { ...budgets.synthetic, '25+live': { fold: 300000, wholeProgram: 1700000 } },
  };
  const [row] = within.synthetic;
  if (row === undefined) throw new Error('fixture');
  const measured: Measurements = {
    ...within,
    synthetic: [...within.synthetic, { ...row, live: true, fold: 290000, wholeProgram: 1650000 }],
  };
  const held = evaluateBudgets(measured, withLive);
  expect(held.failures).toEqual([]);
  expect(held.report.join('\n')).toContain('synthetic 25 modules with live: fold 290,000');
  const over: Measurements = {
    ...within,
    synthetic: [...within.synthetic, { ...row, live: true, fold: 300001, wholeProgram: 1700001 }],
  };
  expect(evaluateBudgets(over, withLive).failures).toEqual([
    'synthetic 25 modules with live: fold 300,001 instantiations, over 300,000',
    'synthetic 25 modules with live: whole program 1,700,001 instantiations, over 1,700,000',
  ]);
  // The plain 25-module row keeps the plain budget: the live budget never judges it.
  expect(
    evaluateBudgets(within, { ...withLive, synthetic: { '25': { fold: 1, wholeProgram: 1 } } })
      .failures,
  ).toHaveLength(2);
});

test('a missing 25+live measurement fails', () => {
  const withLive: Budgets = {
    ...budgets,
    synthetic: { ...budgets.synthetic, '25+live': { fold: 300000, wholeProgram: 1700000 } },
  };
  expect(evaluateBudgets(within, withLive).failures).toEqual([
    'synthetic 25 modules with live: no measurement',
  ]);
});
