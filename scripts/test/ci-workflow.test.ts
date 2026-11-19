import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { workflowJob } from './support/workflow-job.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
const testsJob = workflowJob(workflow, 'tests');
const postgresJob = workflowJob(workflow, 'postgres');

function runLine(job: string): string {
  const line = job
    .split('\n')
    .find((candidate) => candidate.trim().startsWith('run: pnpm exec vitest'));
  expect(line).toBeDefined();
  return line ?? '';
}

function names(line: string, pattern: RegExp): string[] {
  return [...line.matchAll(pattern)].map((match) => match[1] ?? '').sort();
}

test('the in-memory shards leave out exactly the projects the PostgreSQL shards run', () => {
  const excluded = names(runLine(testsJob), /--project '!([^']+)'/g);
  const included = names(runLine(postgresJob), /--project ([^\s'!][^\s']*)/g);
  expect(excluded.length).toBeGreaterThan(0);
  expect(included.length).toBeGreaterThan(0);
  expect(excluded).toEqual(included);
  expect(names(runLine(testsJob), /--project ([^\s'!][^\s']*)/g)).toEqual([]);
});

function projectConfigs(): string[] {
  const found: string[] = [];
  const scan = (directory: string, pattern: RegExp): void => {
    for (const entry of readdirSync(join(repositoryRoot, directory), { withFileTypes: true })) {
      if (entry.isFile() && pattern.test(entry.name)) {
        found.push(join(repositoryRoot, directory, entry.name));
      }
    }
  };
  const children = (directory: string): string[] =>
    readdirSync(join(repositoryRoot, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name));
  for (const directory of children('packages')) {
    scan(directory, /^vitest.*\.config\.ts$/);
  }
  for (const example of children('examples')) {
    try {
      for (const app of children(join(example, 'apps'))) {
        scan(app, /^vitest.*\.config\.ts$/);
      }
    } catch {
      // An example without apps has no project configuration.
    }
  }
  for (const spike of children('spikes')) {
    scan(spike, /^vitest\.config\.ts$/);
  }
  return found;
}

test('the PostgreSQL shards run every project config that spreads the shared run setting', () => {
  const projects = projectConfigs()
    .map((path) => readFileSync(path, 'utf8'))
    .filter((text) => text.includes('...postgresProjectRun,'))
    .map((text) => /name: '([^']+)'/.exec(text)?.[1] ?? '')
    .sort();
  expect(projects.length).toBeGreaterThan(0);
  expect(projects).toEqual(names(runLine(postgresJob), /--project ([^\s'!][^\s']*)/g));
});

test('each sharded job numbers its shards from 1 without a gap and passes its share to Vitest', () => {
  for (const job of [testsJob, postgresJob]) {
    expect(job).toContain('fail-fast: false');
    const matrix = /shard: \[([\d, ]+)\]/.exec(job)?.[1];
    expect(matrix).toBeDefined();
    const shards = (matrix ?? '').split(',').map((part) => Number(part.trim()));
    expect(shards).toEqual(shards.map((_, at) => at + 1));
    expect(job).toContain(`SHARD: \${{ matrix.shard }}/${shards.length}`);
    expect(runLine(job)).toContain('--config vitest.ci.config.ts --shard="$SHARD"');
  }
});

test('every shard builds before it tests', () => {
  for (const job of [testsJob, postgresJob]) {
    const build = job.indexOf('- name: Build\n        run: pnpm tsc -b');
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(job.indexOf('run: pnpm exec vitest'));
  }
});

// The in-memory shards run files that read git history; the PostgreSQL files use none.
test('the in-memory shards check out the full history and the PostgreSQL shards stay shallow', () => {
  expect(testsJob).toContain('fetch-depth: 0');
  expect(postgresJob).not.toContain('fetch-depth');
});

test('the job that gathers the results needs every other job', () => {
  const jobsAt = workflow.indexOf('\njobs:\n');
  const keys = workflow
    .slice(jobsAt)
    .split('\n')
    .map((line) => /^ {2}([\w-]+):$/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined && key !== 'exit-criteria')
    .sort();
  const needs = /needs: \[([^\]]+)\]/.exec(workflowJob(workflow, 'exit-criteria'))?.[1] ?? '';
  expect(
    needs
      .split(',')
      .map((part) => part.trim())
      .sort(),
  ).toEqual(keys);
});

const alwaysRuns = `    if: \${{ always() }}`;

function jobKeys(): string[] {
  const jobsAt = workflow.indexOf('\njobs:\n');
  return workflow
    .slice(jobsAt)
    .split('\n')
    .map((line) => /^ {2}([\w-]+):$/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

function displayName(job: string): string {
  return /^ {4}name: (.+)$/m.exec(job)?.[1] ?? '';
}

function needsOf(job: string): string[] {
  const list = /^ {4}needs: \[([^\]]+)\]$/m.exec(job)?.[1] ?? '';
  return list.split(',').map((part) => part.trim());
}

// A needed job ends as success, failure, cancelled or skipped; the gathering step must fail on
// every result but success. The condition either compares each needed result with 'success'
// (verify-result, postgres-result) or names the three other results with
// contains(needs.*.result, ...) (exit-criteria), and joins the terms with ||.
// The step-level condition needs a status function of its own: without one GitHub adds success()
// and skips the step in a cancelled run, so it is `always() && (a || b)` or, for one comparison,
// `always() && a`.
function failingStepIf(job: string): string {
  return /^ {8}if: \$\{\{ (.+) \}\}$/m.exec(job)?.[1] ?? '';
}

function failingStepCondition(job: string): string[] {
  const condition = failingStepIf(job);
  if (!condition.includes(' || ')) {
    expect(condition.startsWith('always() && ')).toBe(true);
    const comparison = condition.slice('always() && '.length);
    expect(comparison).not.toContain('(');
    return [comparison];
  }
  expect(condition.startsWith('always() && (')).toBe(true);
  expect(condition.endsWith(')')).toBe(true);
  return condition.slice('always() && ('.length, -1).split(' || ').sort();
}

test.each([
  ['Verify', 'verify-result', ['verify', 'tests']],
  ['PostgreSQL 18 suites', 'postgres-result', ['postgres']],
])('exactly one job is named %s and it gathers the results of %j', (name, key, needed) => {
  const named = jobKeys().filter(
    (candidate) => displayName(workflowJob(workflow, candidate)) === name,
  );
  expect(named).toEqual([key]);
  const job = workflowJob(workflow, key);
  expect(needsOf(job).sort()).toEqual([...needed].sort());
  expect(job).toContain(alwaysRuns);
  expect(job).not.toContain('actions/checkout');
  expect(failingStepCondition(job)).toEqual(
    needed.map((neededKey) => `needs.${neededKey}.result != 'success'`).sort(),
  );
});

test('the failing step of each gathering job prints the results through env and holds no expression in run', () => {
  for (const key of ['exit-criteria', 'verify-result', 'postgres-result']) {
    const job = workflowJob(workflow, key);
    expect(job).toMatch(/^ {8}env:\n {10}RESULTS: \$\{\{ toJSON\(needs\) \}\}$/m);
    expect(job).toContain(`run: printf '%s\\n' "$RESULTS"; exit 1`);
    const runLines = job.split('\n').filter((line) => line.trim().startsWith('run:'));
    expect(runLines.length).toBeGreaterThan(0);
    for (const line of runLines) {
      expect(line).not.toContain('${{');
    }
  }
});

test('every job that carries a check name runs also when a needed job did not', () => {
  for (const key of ['exit-criteria', 'verify-result', 'postgres-result']) {
    const job = workflowJob(workflow, key);
    expect(job).toContain(alwaysRuns);
    expect(failingStepIf(job).startsWith('always() && ')).toBe(true);
  }
});

test('the failing step of the exit-criteria job fails on a failed, cancelled or skipped needed job', () => {
  expect(failingStepCondition(workflowJob(workflow, 'exit-criteria'))).toEqual([
    "contains(needs.*.result, 'cancelled')",
    "contains(needs.*.result, 'failure')",
    "contains(needs.*.result, 'skipped')",
  ]);
});

test('the check job of the first stage no longer shares its name with the gathering job', () => {
  expect(displayName(workflowJob(workflow, 'verify'))).toBe('Verify (checks)');
});
