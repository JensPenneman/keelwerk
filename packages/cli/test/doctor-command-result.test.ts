import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { doctorFails } from '../src/commands/doctor/doctor-fails.ts';
import { doctorFlags } from '../src/commands/doctor/doctor-flags.ts';
import { deploymentCheckList } from '../src/doctor/deployment-check-list.ts';
import type { DoctorFinding } from '../src/doctor/doctor-finding.ts';
import { known } from '../src/doctor/known.ts';
import { runDeploymentChecks } from '../src/doctor/run-deployment-checks.ts';
import clean from './layout-fixtures/clean.json' with { type: 'json' };
import { materialise, removeTrees, writeManifests } from './layout-fixtures/materialise-tree.ts';
import { factsOf } from './support/facts-of.ts';
import { createFakeHost } from './support/fake-host.ts';
import { pnpmAnswerOf } from './support/pnpm-answer.ts';
import { runCliWith } from './support/run-cli-with.ts';

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

  /** Each case runs the whole command in this process, over files in a scratch directory, with a fake host that answers the one process it is asked for (pnpm). The artefact check runs in this process too: see the note on the cases. */
  async function run(
    argv: readonly string[],
    config: string | null = configText,
    soundProject = false,
    pnpmVersion = '11.21.0',
  ) {
    const dir = await materialise(soundProject ? soundProjectFiles() : clean.files);
    await writeManifests(dir);
    const here = dirname(fileURLToPath(import.meta.url));
    const configDir = await mkdtemp(join(here, '.doctor-config-'));
    try {
      const path = join(configDir, 'keelwerk.config.ts');
      if (config !== null) await writeFile(path, config);
      const host = createFakeHost({
        spawn: pnpmAnswerOf(pnpmVersion),
        cwd: dir,
        env: Object.fromEntries([['KW_KEY', 'x']]),
        files: {
          [`${dir}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n',
          ...(config === null ? {} : { [path]: '' }),
        },
      });
      return await runCliWith(['doctor', '--config', path, ...argv], host.host);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  }

  /** The conventions workspace with only the module that imports no other (the artefact check loads each module by its package name), and with the tools the environment check looks for: no error of the project is left to decide the exit code. */
  function soundProjectFiles(): Record<string, string> {
    const modules = Object.entries(clean.files).filter(
      ([path]) => !path.startsWith('apps/') && !path.startsWith('packages/module-shop/'),
    );
    return {
      ...Object.fromEntries(modules),
      'node_modules/typescript/package.json': '{"version":"7.0.2"}',
      'node_modules/@biomejs/biome/package.json': '{"version":"2.6.3"}',
    };
  }

  const findingsOf = (stdout: string) => JSON.parse(stdout) as DoctorFinding[];

  test('the text summary ends with the number of findings of each severity, counted by their lines', async () => {
    const result = await run(['--output', 'text']);
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
  }, 60_000);

  test('the findings as data keep the checks under their old names: the checks doctor has that did not run are not-checked, the checks it does not have are notes', async () => {
    const result = await run(['--output', 'json']);
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
  }, 60_000);

  test('the pnpm version in the findings is the one the host answered, not the one on this machine', async () => {
    const result = await run(['--output', 'json'], configText, true, '10.9.0');
    expect(
      findingsOf(result.stdout)
        .filter((entry) => entry.check === 'environment' && entry.subject === 'pnpm')
        .map((entry) => [entry.severity, entry.message, entry.fix]),
    ).toEqual([
      ['warning', 'pnpm 10.9.0 is installed, the workspace pins 11.21.0', 'install pnpm 11.21.0'],
    ]);
  }, 60_000);

  test('no deployment file: one line that the deployment checks did not run', async () => {
    const result = await run(['--output', 'json'], null);
    const lines = findingsOf(result.stdout).filter((entry) => entry.check === 'deployment');
    expect(lines.map((entry) => [entry.severity, entry.subject])).toEqual([
      ['not-checked', 'deployment file'],
    ]);
  }, 60_000);

  test('each connection flag that is given gets its note, and only it', async () => {
    const notes = async (flags: readonly string[]) =>
      findingsOf((await run(['--layout', '--output', 'json', ...flags])).stdout)
        .filter((entry) => entry.check === 'doctor')
        .map((entry) => [entry.severity, entry.subject, entry.message]);
    for (const flag of ['profile', 'backend', 'tenant', 'socket']) {
      expect(await notes([`--${flag}`, 'x'])).toEqual([
        ['note', `--${flag}`, `--${flag} has no effect on doctor yet`],
      ]);
    }
    expect(await notes([])).toEqual([]);
  }, 120_000);

  test('--strict reaches the exit code: the same lines exit 0 without it and 1 with it', async () => {
    const plain = await run(['--output', 'json'], configText, true);
    const strict = await run(['--strict', '--output', 'json'], configText, true);
    expect(findingsOf(plain.stdout).some((entry) => entry.severity === 'error')).toBe(false);
    expect(findingsOf(plain.stdout).some((entry) => entry.severity === 'not-checked')).toBe(true);
    expect(plain.code).toBe(0);
    expect(strict.code).toBe(1);
    expect(strict.stdout).toBe(plain.stdout);
  }, 120_000);

  test('--strict with no deployment file exits 1, and without it exits 0', async () => {
    expect((await run(['--output', 'json'], null, true)).code).toBe(0);
    expect((await run(['--strict', '--output', 'json'], null, true)).code).toBe(1);
  }, 120_000);

  test('--layout --strict on a layout without findings exits 0', async () => {
    expect((await run(['--layout', '--strict', '--output', 'text'])).code).toBe(0);
  }, 60_000);
});
