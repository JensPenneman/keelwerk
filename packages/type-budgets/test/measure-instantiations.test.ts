import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { measureInstantiations } from '../../../scripts/type-budgets/measure-instantiations.ts';
import { runTsc } from '../../../scripts/type-budgets/run-tsc.ts';
import { throwOnCompileErrors } from '../../../scripts/type-budgets/throw-on-compile-errors.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));

test('a three-module workspace compiles with no error in the whole program, the build and the fold', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'measure-instantiations-test-'));
  try {
    throwOnCompileErrors('packages/core', runTsc(repo, ['-b', 'packages/core'], repo), []);
    // measureInstantiations throws on any compiler error other than a portability one.
    const [row] = measureInstantiations([3], repo, scratch);
    expect(row?.modules).toBe(3);
    expect(row?.portability).toEqual([]);
    expect(row?.wholeProgram).toBeGreaterThan(0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 300_000);

test('a three-module workspace with the live module compiles and every entity has watch', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'measure-instantiations-live-test-'));
  try {
    const [row] = measureInstantiations([3], repo, scratch, { live: true });
    expect(row).toMatchObject({ modules: 3, live: true, portability: [] });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 300_000);

test('a compiler error line other than an allowed code throws', () => {
  const output = "a.ts(1,1): error TS2307: Cannot find module 'x'.\nb.ts(1,1): error TS2883: no.";
  expect(() => throwOnCompileErrors('x', output, ['TS2883'])).toThrow('TS2307');
  expect(() => throwOnCompileErrors('x', 'b.ts(1,1): error TS2883: no.', ['TS2883'])).not.toThrow();
});
