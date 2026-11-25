import { afterEach, describe, expect, test } from 'vitest';
import { doctorFails } from '../src/commands/doctor/doctor-fails.ts';
import { doctorFlags } from '../src/commands/doctor/doctor-flags.ts';
import { absent } from '../src/doctor/absent.ts';
import { deploymentCheckList } from '../src/doctor/deployment-check-list.ts';
import type { DoctorFinding } from '../src/doctor/doctor-finding.ts';
import { known } from '../src/doctor/known.ts';
import { runDeploymentChecks } from '../src/doctor/run-deployment-checks.ts';
import { removeTrees } from './layout-fixtures/materialise-tree.ts';
import { factsOf } from './support/facts-of.ts';
import { runDoctorCommand } from './support/run-doctor-command.ts';

afterEach(removeTrees);

const finding = (severity: DoctorFinding['severity']): DoctorFinding => ({
  check: 'c',
  severity,
  subject: 's',
  message: 'm',
  fix: 'f',
});

describe('what decides the exit code of doctor', () => {
  const plain = {};
  const strict = { strict: true };

  test('an error fails, with and without --strict; a warning, a note and a check that did not run pass', () => {
    expect(doctorFails(plain, [finding('error')])).toBe(true);
    expect(doctorFails(strict, [finding('error')])).toBe(true);
    for (const severity of ['warning', 'note', 'not-checked'] as const) {
      expect(doctorFails(plain, [finding(severity)])).toBe(false);
    }
    expect(doctorFails(strict, [finding('warning'), finding('note')])).toBe(false);
    expect(doctorFails(strict, [])).toBe(false);
  });

  test('with --strict a check that did not run fails', () => {
    expect(doctorFails(strict, [finding('note'), finding('not-checked')])).toBe(true);
    expect(doctorFails({ strict: false }, [finding('not-checked')])).toBe(false);
  });

  test('notes that doctor does not check something are no check that did not run: --strict leaves them alone', () => {
    const notes = runDeploymentChecks(
      deploymentCheckList.filter((check) => check.kind === 'unfed'),
      factsOf({ ledgerSinks: known(1), personalFields: known([]) }),
    );
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((entry) => entry.severity === 'note')).toBe(true);
    expect(doctorFails(strict, notes)).toBe(false);
    expect(doctorFails(strict, [...notes, finding('not-checked')])).toBe(true);
  });

  test('each of the five facts of the control store, when it could not be read, is a finding that fails --strict like an error, and the plain run does not fail on it', () => {
    for (const name of [
      'controlReachable',
      'hookFailures',
      'processes',
      'bumpedMarks',
      'heldTenants',
    ] as const) {
      const found = runDeploymentChecks(
        deploymentCheckList,
        factsOf({ [name]: absent('the store did not answer', 'run doctor again') }),
      );
      expect(found.some((entry) => entry.severity === 'not-checked')).toBe(true);
      expect(found.every((entry) => entry.severity !== 'error')).toBe(true);
      expect(doctorFails(strict, found)).toBe(true);
      expect(doctorFails(plain, found)).toBe(false);
    }
  });

  test('warnings and notes never change the exit code, strict or not', () => {
    expect(doctorFails(strict, [finding('warning'), finding('note')])).toBe(false);
    expect(doctorFails(plain, [finding('warning'), finding('note')])).toBe(false);
  });

  test('the command takes --strict as a switch', () => {
    expect(doctorFlags().strict).toMatchObject({ kind: 'boolean' });
  });
});

describe('the doctor command, its summary, its notes and its strict flag', () => {
  const configText = [
    "import { memoryAdapter } from '@keelwerk/data';",
    "import { secret } from '@keelwerk/core';",
    '',
    'export default {',
    '  apps: [],',
    '  infrastructure: [memoryAdapter()],',
    "  control: { adapter: 'memory' },",
    "  placements: { main: { adapter: 'memory', strategy: 'shared-tables' } },",
    "  keys: { masterKey: secret('KW_KEY') },",
    '};',
    '',
  ].join('\n');

  const findingsOf = (stdout: string) => JSON.parse(stdout) as DoctorFinding[];

  test('the text summary ends with the number of findings of each severity, counted by their lines', async () => {
    const result = await runDoctorCommand(['--output', 'text'], configText);
    const lines = (severity: string) =>
      result.stdout.split('\n').filter((line) => line.startsWith(`${severity} [`)).length;
    const summary =
      /(\d+) error\(s\), (\d+) warning\(s\), (\d+) note\(s\), (\d+) not checked$/.exec(
        result.stdout.trim(),
      );
    expect(lines('not-checked')).toBeGreaterThan(0);
    expect(lines('note')).toBeGreaterThan(0);
    expect(summary?.slice(1).map(Number)).toEqual(
      ['error', 'warning', 'note', 'not-checked'].map(lines),
    );
  });

  test('the findings as data keep the checks under their old names: the checks doctor has that did not run are not-checked, the checks it does not have are notes', async () => {
    const result = await runDoctorCommand(['--output', 'json'], configText);
    const found = findingsOf(result.stdout);
    const unrun = found.filter((entry) => entry.severity === 'not-checked');
    expect(unrun.map((entry) => entry.check)).toEqual(
      expect.arrayContaining(['deployment', 'health', 'epoch-bumps', 'held-tenants']),
    );
    expect(unrun.every((entry) => entry.message !== '' && entry.fix !== '')).toBe(true);
    const unfed = found.filter((entry) => entry.message.startsWith('doctor does not check this: '));
    expect(unfed.map((entry) => entry.check)).toEqual(
      expect.arrayContaining(['deployment', 'queues', 'health']),
    );
    expect(unfed.every((entry) => entry.severity === 'note' && entry.fix === 'none needed')).toBe(
      true,
    );
    expect(unfed.length).toBeGreaterThan(0);
    for (const entry of found) {
      expect(`${entry.message} ${entry.fix}`).not.toMatch(/\bWP-\d+|\bS-\d+|\bM\d\b/);
    }
  });

  test('the pnpm version in the findings is the one the host answered, not the one on this machine', async () => {
    const result = await runDoctorCommand(['--output', 'json'], configText, {
      soundProject: true,
      pnpmVersion: '10.9.0',
    });
    expect(
      findingsOf(result.stdout)
        .filter((entry) => entry.check === 'environment' && entry.subject === 'pnpm')
        .map((entry) => [entry.severity, entry.message, entry.fix]),
    ).toEqual([
      ['warning', 'pnpm 10.9.0 is installed, the workspace pins 11.21.0', 'install pnpm 11.21.0'],
    ]);
  });

  test('no deployment file: one line that the deployment checks did not run', async () => {
    const result = await runDoctorCommand(['--output', 'json'], null);
    const lines = findingsOf(result.stdout).filter((entry) => entry.check === 'deployment');
    expect(lines.map((entry) => [entry.severity, entry.subject])).toEqual([
      ['not-checked', 'deployment file'],
    ]);
  });

  test('each connection flag that is given gets its note, and only it', async () => {
    const notes = async (flags: readonly string[]) =>
      findingsOf(
        (await runDoctorCommand(['--layout', '--output', 'json', ...flags], configText)).stdout,
      )
        .filter((entry) => entry.check === 'doctor')
        .map((entry) => [entry.severity, entry.subject, entry.message]);
    for (const flag of ['profile', 'backend', 'tenant', 'socket']) {
      expect(await notes([`--${flag}`, 'x'])).toEqual([
        ['note', `--${flag}`, `--${flag} has no effect on doctor yet`],
      ]);
    }
    expect(await notes([])).toEqual([]);
  });

  test('--strict reaches the exit code: the same lines exit 0 without it and 1 with it', async () => {
    const plain = await runDoctorCommand(['--output', 'json'], configText, { soundProject: true });
    const strict = await runDoctorCommand(['--strict', '--output', 'json'], configText, {
      soundProject: true,
    });
    expect(findingsOf(plain.stdout).some((entry) => entry.severity === 'error')).toBe(false);
    expect(findingsOf(plain.stdout).some((entry) => entry.severity === 'not-checked')).toBe(true);
    expect(plain.code).toBe(0);
    expect(strict.code).toBe(1);
    expect(strict.stdout).toBe(plain.stdout);
  });

  test('--strict with no deployment file exits 1, and without it exits 0', async () => {
    expect((await runDoctorCommand(['--output', 'json'], null, { soundProject: true })).code).toBe(
      0,
    );
    expect(
      (await runDoctorCommand(['--strict', '--output', 'json'], null, { soundProject: true })).code,
    ).toBe(1);
  });

  test('--layout --strict on a layout without findings exits 0', async () => {
    expect(
      (await runDoctorCommand(['--layout', '--strict', '--output', 'text'], configText)).code,
    ).toBe(0);
  });
});
