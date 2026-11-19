import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { configDefaults } from 'vitest/config';
import { CiTestReporter } from '../ci-test-reporter.ts';
import { inFlightLine } from '../in-flight-line.ts';
import { slowestLines } from '../slowest-lines.ts';

afterEach(() => {
  vi.useRealTimers();
});

function testCase(
  file: string,
  fullName: string,
  duration: number | undefined,
): Parameters<CiTestReporter['onTestCaseResult']>[0] {
  return {
    fullName,
    module: { moduleId: file },
    diagnostic: () => (duration === undefined ? undefined : { duration }),
  };
}

test('inFlightLine names nothing when no file runs', () => {
  expect(inFlightLine(new Map(), 1000)).toBeUndefined();
});

test('inFlightLine names the files in flight, longest running first, with whole seconds', () => {
  const started = new Map([
    ['b.test.ts', 5000],
    ['a.test.ts', 0],
  ]);
  expect(inFlightLine(started, 125_400)).toBe(
    'Test files in flight: a.test.ts (125 s), b.test.ts (120 s)',
  );
});

test('slowestLines is empty without timings', () => {
  expect(slowestLines('Slowest', [], 3)).toEqual([]);
});

test('slowestLines lists the slowest first, ties by name, at most the limit', () => {
  expect(
    slowestLines(
      'Slowest',
      [
        { name: 'y', duration: 500 },
        { name: 'x', duration: 12_345 },
        { name: 'b', duration: 500 },
        { name: 'z', duration: 1 },
      ],
      3,
    ),
  ).toEqual(['Slowest:', '   12.35 s  x', '    0.50 s  b', '    0.50 s  y']);
});

test('the heartbeat writes the files in flight and nothing while none runs', () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  let clock = 0;
  const reporter = new CiTestReporter({
    write: (text) => writes.push(text),
    now: () => clock,
    heartbeatMs: 1000,
  });
  reporter.onInit({ config: { root: '/repo' } });
  reporter.onTestRunStart();
  vi.advanceTimersByTime(1000);
  expect(writes).toEqual([]);
  reporter.onTestModuleQueued({ moduleId: '/repo/packages/a/test/x.test.ts' });
  clock = 2000;
  vi.advanceTimersByTime(1000);
  expect(writes).toEqual(['Test files in flight: packages/a/test/x.test.ts (2 s)\n']);
  reporter.onTestModuleEnd({ moduleId: '/repo/packages/a/test/x.test.ts' });
  vi.advanceTimersByTime(1000);
  expect(writes).toHaveLength(1);
  reporter.onTestRunEnd();
});

test('the end of a run writes the slowest tests and files and stops the heartbeat', () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  let clock = 0;
  const reporter = new CiTestReporter({
    write: (text) => writes.push(text),
    now: () => clock,
    heartbeatMs: 1000,
  });
  const x = '/repo/packages/a/test/x.test.ts';
  const y = '/repo/packages/a/test/y.test.ts';
  reporter.onInit({ config: { root: '/repo' } });
  reporter.onTestRunStart();
  reporter.onTestModuleQueued({ moduleId: x });
  reporter.onTestModuleQueued({ moduleId: y });
  reporter.onTestCaseResult(testCase(x, 'suite > case', 1500));
  reporter.onTestCaseResult(testCase(x, 'suite > skipped', undefined));
  reporter.onTestCaseResult(testCase(y, 'other', 200));
  clock = 3000;
  reporter.onTestModuleEnd({ moduleId: x });
  clock = 4000;
  reporter.onTestModuleEnd({ moduleId: y });
  reporter.onTestRunEnd();
  expect(writes).toEqual([
    '\nSlowest tests:\n    1.50 s  packages/a/test/x.test.ts > suite > case\n    0.20 s  packages/a/test/y.test.ts > other\n',
    '\nSlowest test files:\n    4.00 s  packages/a/test/y.test.ts\n    3.00 s  packages/a/test/x.test.ts\n',
  ]);
  vi.advanceTimersByTime(10_000);
  expect(writes).toHaveLength(2);
});

test('a run adds one exit listener and its end removes it', () => {
  const before = process.listenerCount('exit');
  const reporter = new CiTestReporter({ write: () => undefined });
  reporter.onTestRunStart();
  expect(process.listenerCount('exit')).toBe(before + 1);
  reporter.onTestRunEnd();
  expect(process.listenerCount('exit')).toBe(before);
});

test('a file still running at the end is named after the slowest blocks', () => {
  const writes: string[] = [];
  let clock = 0;
  const reporter = new CiTestReporter({ write: (text) => writes.push(text), now: () => clock });
  reporter.onInit({ config: { root: '/repo' } });
  reporter.onTestRunStart();
  reporter.onTestModuleQueued({ moduleId: '/repo/a.test.ts' });
  clock = 7000;
  reporter.onTestRunEnd();
  expect(writes.at(-1)).toBe('Test files in flight: a.test.ts (7 s)\n');
});

test('the CI configuration keeps the default reporter, attaches the reporter once and keeps the projects', async () => {
  const ci = (await import('../../vitest.ci.config.ts')).default;
  const root = (await import('../../vitest.config.ts')).default;
  const reporters = ci.test?.reporters ?? [];
  expect(reporters.filter((r: unknown) => !(r instanceof CiTestReporter))).toEqual(
    configDefaults.reporters,
  );
  expect(reporters.filter((reporter: unknown) => reporter instanceof CiTestReporter)).toHaveLength(
    1,
  );
  expect(ci.test?.projects).toEqual(root.test?.projects);
});
