import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const script = new URL('../../../scripts/type-budgets/run-budgets.ts', import.meta.url);

const size = {
  name: 'm01',
  manifestBytes: 2880,
  totalBytes: 12317,
  largestFile: 'a.d.ts',
  largestBytes: 1,
};
const clean = {
  synthetic: [
    { modules: 25, fold: 200000, wholeProgram: 1000000, sizes: [size], portability: [] },
    { modules: 40, fold: 300000, wholeProgram: 1800000, sizes: [size], portability: [] },
  ],
  apps: {},
  modulePackages: [],
  workspacePortability: [],
};

function gate(measurements: unknown): { status: number | null; stdout: string; stderr: string } {
  const directory = mkdtempSync(join(tmpdir(), 'run-budgets-test-'));
  try {
    const file = join(directory, 'measurements.json');
    writeFileSync(file, JSON.stringify(measurements));
    const run = spawnSync(process.execPath, [fileURLToPath(script), '--measurements', file], {
      encoding: 'utf8',
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('exits 0 when every count is within its budget', () => {
  const run = gate(clean);
  expect(run.status).toBe(0);
  expect(run.stdout).toContain('type budgets hold');
});

test('exits 1 for an injected over-budget count', () => {
  const run = gate({
    ...clean,
    synthetic: [{ ...clean.synthetic[0], fold: 246001 }, clean.synthetic[1]],
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('fold 246,001 instantiations, over 246,000');
});

test('exits 1 for an injected TS2883', () => {
  const run = gate({
    ...clean,
    workspacePortability: [
      "packages/m01/src/base.ts(1,1): error TS2883: The inferred type of 'm01' cannot be named.",
    ],
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('TS2883');
});

test('exits 1 when a budgeted module count has no measurement', () => {
  const run = gate({ ...clean, synthetic: [clean.synthetic[0]] });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('synthetic 40 modules: no measurement');
});
