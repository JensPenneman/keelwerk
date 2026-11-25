import { afterEach, describe, expect, test } from 'vitest';
import type { DoctorFinding } from '../src/doctor/doctor-finding.ts';
import { doctorReadBounds } from '../src/doctor/doctor-read-bounds.ts';
import { removeTrees } from './layout-fixtures/materialise-tree.ts';
import type { FakeHost } from './support/fake-host.ts';
import { runDoctorCommand } from './support/run-doctor-command.ts';
import { sharedControlStores } from './support/shared-control-stores.ts';
import { stepTimers } from './support/step-timers.ts';

afterEach(removeTrees);

/** A deployment file whose one adapter refuses to be created, with the url in the message the way a driver words it. */
const refusingConfig = [
  "import { secret } from '@keelwerk/core';",
  "import { libraryApp } from '@keelwerk/testing/fixtures';",
  '',
  "const refusing = { id: 'refusing', dialect: 'postgres', create: (placement) => { throw new Error('no route to ' + placement.url); } };",
  '',
  'export default {',
  '  apps: [libraryApp],',
  '  infrastructure: [refusing],',
  "  control: { adapter: 'refusing', url: 'postgres://kw:hunter2@db1:5432/control' },",
  "  placements: { main: { adapter: 'refusing', url: 'postgres://kw:hunter2@db1:5432/app' } },",
  "  keys: { masterKey: secret('KW_KEY') },",
  '};',
  '',
].join('\n');

const findingsOf = (stdout: string) => JSON.parse(stdout) as DoctorFinding[];

describe('the doctor command over a control store that does not answer', () => {
  test('says so as an error, leaves the other reader checks not checked, exits 1 even with --strict off, and prints no password', async () => {
    const result = await runDoctorCommand(['--output', 'json'], refusingConfig, {
      soundProject: true,
    });
    expect(result.stdout).not.toContain('hunter2');
    expect(result.stdout).toContain('[hidden]');
    const found = findingsOf(result.stdout);
    expect(
      found
        .filter((entry) => entry.subject === 'control store' && entry.severity === 'error')
        .map((entry) => entry.message),
    ).toEqual([
      'the control store is not reachable: control: no route to postgres://kw:[hidden]@db1:5432/control',
    ]);
    const others = found.filter(
      (entry) =>
        entry.severity === 'not-checked' &&
        ['processes', 'failed tenant hooks', 'epoch bumps', 'held tenants'].includes(entry.subject),
    );
    expect(others.map((entry) => entry.subject).sort()).toEqual([
      'epoch bumps',
      'failed tenant hooks',
      'held tenants',
      'processes',
    ]);
    expect(
      others.every((entry) =>
        entry.message.includes(
          'the control store did not answer: control: no route to postgres://kw:[hidden]@db1:5432/control',
        ),
      ),
    ).toBe(true);
    expect(result.code).toBe(1);
  });

  test('the placement that could not be opened prints its message as it came, without the password', async () => {
    const found = findingsOf(
      (await runDoctorCommand(['--output', 'json'], refusingConfig, { soundProject: true })).stdout,
    );
    const placement = found.filter((entry) =>
      entry.message.includes('the placement could not be opened'),
    );
    expect(placement.length).toBeGreaterThan(0);
    expect(
      placement.every((entry) =>
        entry.message.includes('no route to postgres://kw:[hidden]@db1:5432/'),
      ),
    ).toBe(true);
  });

  /** A deployment file whose control store is one of the shared fakes. */
  const configOver = (store: keyof typeof sharedControlStores) =>
    [
      "import { secret } from '@keelwerk/core';",
      "import { libraryApp } from '@keelwerk/testing/fixtures';",
      "import { sharedControlStores } from '../support/shared-control-stores.ts';",
      '',
      'export default {',
      '  apps: [libraryApp],',
      `  infrastructure: [sharedControlStores.${store}.factory],`,
      "  control: { adapter: 'fake', url: 'postgres://kw:hunter2@db1:5432/control' },",
      '  placements: {},',
      "  keys: { masterKey: secret('KW_KEY') },",
      '};',
      '',
    ].join('\n');
  const answeringConfig = configOver('answering');

  test('every adapter the command created is closed when it ends', async () => {
    sharedControlStores.answering.created.length = 0;
    sharedControlStores.answering.closed.length = 0;
    const result = await runDoctorCommand(['--output', 'json'], answeringConfig, {
      soundProject: true,
    });
    expect(sharedControlStores.answering.created.length).toBeGreaterThan(2);
    expect(sharedControlStores.answering.closed.sort()).toEqual(
      sharedControlStores.answering.created.map((_, index) => index),
    );
    expect(result.stderr).toBe('');
    expect(
      findingsOf(result.stdout).filter((entry) => entry.subject === 'control store reachable'),
    ).toEqual([]);
  });

  test('and when the command fails before it ends', async () => {
    sharedControlStores.answering.created.length = 0;
    sharedControlStores.answering.closed.length = 0;
    const failing = () => {
      throw new Error('the host cannot start a process');
    };
    const result = await runDoctorCommand(['--output', 'json'], answeringConfig, {
      soundProject: true,
      spawn: failing,
    });
    expect(result.code).not.toBe(0);
    expect(sharedControlStores.answering.created.length).toBeGreaterThan(2);
    expect(sharedControlStores.answering.closed.sort()).toEqual(
      sharedControlStores.answering.created.map((_, index) => index),
    );
  });

  test.each(['silentUnit', 'silentHistory', 'silentConnect'] as const)(
    'a control store that never answers (%s) has its deadline pending as soon as it is asked, is an error at the deadline, the other reader checks are not checked, and the exit code is 1',
    async (store) => {
      let host: FakeHost | undefined;
      const running = runDoctorCommand(['--output', 'json'], configOver(store), {
        soundProject: true,
        onHost: (made) => {
          host = made;
        },
      });
      await sharedControlStores[store].asked;
      expect(
        host?.timers.some(
          (timer) => !timer.cancelled && timer.milliseconds === doctorReadBounds.deadlineMs,
        ),
      ).toBe(true);
      const result = await stepTimers(host as FakeHost, running);
      const found = findingsOf(result.stdout);
      expect(
        found
          .filter((entry) => entry.subject === 'control store' && entry.severity === 'error')
          .map((entry) => entry.message),
      ).toEqual([expect.stringContaining('no answer within the bound')]);
      expect(
        found.filter(
          (entry) =>
            entry.severity === 'not-checked' &&
            entry.message.includes('the control store did not answer'),
        ),
      ).toHaveLength(4);
      expect(result.code).toBe(1);
      expect(sharedControlStores[store].closed.length).toBeGreaterThan(0);
    },
  );

  test('a password in the error of a deployment file that does not load is hidden too', async () => {
    const result = await runDoctorCommand(
      ['--output', 'json'],
      "throw new Error('cannot use postgres://kw:hunter2@db1/app');\nexport default {};\n",
      { soundProject: true },
    );
    expect(result.stdout).not.toContain('hunter2');
    expect(result.stdout).toContain('postgres://kw:[hidden]@db1/app');
    expect(findingsOf(result.stdout).filter((entry) => entry.severity === 'error')).toHaveLength(1);
    expect(result.code).toBe(1);
  });
});
