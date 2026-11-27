import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import ciConfig from '../../vitest.ci.config.ts';
import { mappingProblems, reportOf } from '../exit-criteria-m2.ts';
import { workflowJob } from './support/workflow-job.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mapping = JSON.parse(
  readFileSync(join(repositoryRoot, 'scripts/exit-criteria-m2.json'), 'utf8'),
) as { criteria: { number: number; text: string; evidence: string[] }[] };
const criteria = [
  {
    number: 1,
    text: 'one',
    evidence: ['a/one.test.ts', 'a/two.test.ts'],
    skips: [{ file: 'a/two.test.ts', count: 1, why: 'by design' }],
  },
  { number: 2, text: 'two', evidence: ['b/three.test.ts'] },
];
const ran = (name: string, ...statuses: string[]) => ({
  name: `/work/${name}`,
  status: 'passed',
  assertionResults: statuses.map((status, at) => ({ fullName: `case ${at}`, status })),
});

test('the mapping lists the eleven criteria and every evidence file exists', () => {
  expect(
    mappingProblems(mapping.criteria, (path) => existsSync(join(repositoryRoot, path))),
  ).toEqual([]);
});

test('a renamed file, an empty list and a missing number fail the mapping', () => {
  expect(mappingProblems(criteria.slice(0, 1), () => true)).toEqual([
    'the criteria must be numbered exactly 1 to 11, found: 1',
  ]);
  expect(
    mappingProblems(
      criteria.slice(0, 1).map((criterion) => ({ ...criterion, evidence: [] })),
      () => true,
    ),
  ).toContain('criterion 1 has no evidence');
  expect(
    mappingProblems(mapping.criteria, (path) => !path.endsWith('worker-killed.postgres.test.ts')),
  ).toEqual(['criterion 9: no file packages/testing/test/kernel/worker-killed.postgres.test.ts']);
});

test('tests that all passed give no problem and are counted per criterion', () => {
  const { rows, problems } = reportOf(criteria, {
    testResults: [
      ran('a/one.test.ts', 'passed'),
      ran('a/two.test.ts', 'passed', 'skipped'),
      ran('b/three.test.ts', 'passed'),
    ],
  });
  expect(problems).toEqual([]);
  expect(rows[0]).toContain(' 1  2 files, 2 tests passed, 1 skipped by design  one');
  expect(rows[1]).toContain(' 2  1 files, 1 tests passed, 0 skipped by design  two');
});

test('a skip beyond the allowed number, a to-do or failed test, a file with no test and a file that did not run fail', () => {
  const { problems } = reportOf(criteria, {
    testResults: [
      ran('a/one.test.ts', 'passed', 'skipped', 'todo', 'failed'),
      ran('a/two.test.ts'),
    ],
  });
  expect(problems).toEqual([
    'criterion 1: a/one.test.ts: todo: case 2',
    'criterion 1: a/one.test.ts: failed: case 3',
    'criterion 1: a/one.test.ts: 1 skipped, 0 allowed (first: case 1)',
    'criterion 1: a/two.test.ts runs no test (passed)',
    'criterion 1: a/two.test.ts: 0 skipped, 1 allowed',
    'criterion 2: b/three.test.ts did not run',
  ]);
});

test('a skip that the mapping names must be in an evidence file of its criterion', () => {
  const skips = [{ file: 'a/other.test.ts', count: 1, why: 'x' }];
  expect(
    mappingProblems([{ number: 1, text: 'one', evidence: ['a/one.test.ts'], skips }], () => true),
  ).toContain('criterion 1: skips name a/other.test.ts, not an evidence file or no skip');
});

test('the pipeline runs the listed files in a job of its own and a CI run that finds no test fails', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const job = workflowJob(workflow, 'exit-criteria-m2');
  expect(job).toContain('name: M2 exit criteria');
  expect(job).toContain('node scripts/exit-criteria-m2.ts --files');
  expect(job).toContain('--config vitest.ci.config.ts');
  expect(job).toMatch(/run: node scripts\/exit-criteria-m2\.ts "\$RUNNER_TEMP\/m2-report\.json"/);
  expect(ciConfig.test?.passWithNoTests).toBe(false);
});
