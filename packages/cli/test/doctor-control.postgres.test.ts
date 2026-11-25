import { createRequire } from 'node:module';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { createControlLedger } from '@keelwerk/core';
import { startTestRuntime } from '@keelwerk/testing';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { DoctorFinding } from '../src/doctor/doctor-finding.ts';
import { removeTrees } from './layout-fixtures/materialise-tree.ts';
import { failingHookApp } from './support/failing-hook-app.ts';
import { runDoctorCommand } from './support/run-doctor-command.ts';

const configOf = (ownerUrl: string) =>
  [
    "import { postgresAdapter } from '@keelwerk/adapter-postgres';",
    "import { env, secret } from '@keelwerk/core';",
    "import { failingHookApp } from '../support/failing-hook-app.ts';",
    '',
    'export default {',
    '  apps: [failingHookApp],',
    `  infrastructure: [postgresAdapter({ ownerUrl: '${ownerUrl}' })],`,
    "  control: { adapter: 'postgres', url: env('KW_TEST_URL') },",
    "  placements: { main: { adapter: 'postgres', strategy: 'shared-tables', url: env('KW_TEST_URL') } },",
    "  keys: { masterKey: secret('KW_KEY') },",
    '};',
    '',
  ].join('\n');

const findingsOf = (stdout: string) => JSON.parse(stdout) as DoctorFinding[];

describe('doctor over a deployment on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let runtime:
    | Awaited<ReturnType<typeof startTestRuntime<typeof failingHookApp, 'acme'>>>
    | undefined;
  /** Runs doctor over the database, at its url unless another is given. */
  const doctor = async (
    argv: readonly string[],
    url = postgres.appUrl,
    over: { readonly owner?: string; readonly stepTimers?: Promise<unknown> } = {},
  ) => {
    const result = await runDoctorCommand(
      ['--output', 'json', ...argv],
      configOf(over.owner ?? postgres.adminUrl),
      {
        soundProject: true,
        environment: Object.fromEntries([['KW_TEST_URL', url]]),
        ...(over.stepTimers === undefined ? {} : { stepTimers: over.stepTimers }),
      },
    );
    return { ...result, found: findingsOf(result.stdout) };
  };

  let tenantId = '';
  let controlRoot = '';

  beforeAll(async () => {
    postgres = await startPostgres();
    runtime = await startTestRuntime(failingHookApp, {
      external: {
        factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
        url: postgres.appUrl,
      },
      tenants: ['acme'],
      workers: true,
    });
    tenantId = runtime.tenants.acme.id;
    controlRoot = runtime.control.namespace.root;
  });

  afterEach(removeTrees);

  afterAll(async () => {
    await runtime?.stop(1000);
    await postgres?.stop();
  });

  test('a deployment whose checks all ran passes --strict, and its process row is read', async () => {
    const result = await doctor(['--strict']);
    expect(result.found.filter((entry) => entry.severity === 'not-checked')).toEqual([]);
    expect(result.found.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(result.found.some((entry) => entry.subject === 'processes')).toBe(false);
    expect(result.code).toBe(0);
  });

  test('a tenant hook that failed is listed with its tenant', async () => {
    await runtime?.drainJobs();
    const { found } = await doctor([]);
    expect(
      found
        .filter((entry) => entry.check === 'deployment' && entry.subject === tenantId)
        .map((entry) => entry.message),
    ).toEqual([expect.stringContaining(`failed for tenant ${tenantId}`)]);
  });

  test('an epoch above 0 in the marks is listed', async () => {
    const control = runtime?.control;
    await control?.adapter.unit(control.namespace, { level: 'deployment' }, async (unit) =>
      unit.marks?.bump(
        {
          scopeId: tenantId,
          namespaceId: 'ns-restored',
          epoch: 2,
          position: 0n,
          serials: {},
          updatedAt: Temporal.Now.instant(),
        },
        0,
      ),
    );
    const { found } = await doctor([]);
    expect(
      found.filter((entry) => entry.check === 'epoch-bumps').map((entry) => entry.subject),
    ).toEqual(['ns-restored']);
  });

  test('a tenant with an erasure left to run is listed as held', async () => {
    const control = runtime?.control;
    if (control === undefined) throw new Error('the runtime is not running');
    await createControlLedger(control.adapter, control.namespace).append({
      type: 'erasure',
      tenantId,
      subjectId: 'subject-1',
      recordedAt: '2026-11-24T10:00:00Z',
      requester: { kind: 'system', id: null, via: 'test' },
      reason: 'operator',
      commandId: 'command-1',
    });
    const { found } = await doctor([]);
    expect(
      found.filter((entry) => entry.check === 'held-tenants').map((entry) => entry.subject),
    ).toEqual([tenantId]);
  });

  test('a store that does not answer is an error, the others are not checked, and --strict exits 1', async () => {
    const unreachable = new URL(postgres.appUrl);
    unreachable.port = '1';
    const result = await doctor(['--strict'], unreachable.href);
    expect(
      result.found
        .filter((entry) => entry.subject === 'control store' && entry.severity === 'error')
        .map((entry) => entry.message),
    ).toEqual([expect.stringContaining('the control store is not reachable')]);
    expect(
      result.found.filter(
        (entry) =>
          entry.severity === 'not-checked' &&
          entry.message.includes('the control store did not answer'),
      ),
    ).toHaveLength(4);
    expect(result.stdout).not.toContain(new URL(postgres.appUrl).password);
    expect(result.code).toBe(1);
  });

  test('a process that stopped is no running process', async () => {
    await runtime?.stop(1000);
    runtime = undefined;
    const { found } = await doctor([]);
    expect(
      found.filter((entry) => entry.check === 'health').map((entry) => entry.message),
    ).toContain('the control store lists no running process');
  });

  test('a refused owner url is a store that cannot be read, never a deployment that never started', async () => {
    const owner = new URL(postgres.adminUrl);
    owner.password = 'WrongMadeUpWord';
    const result = await doctor(['--strict'], postgres.appUrl, { owner: owner.href });
    expect(
      result.found
        .filter((entry) => entry.subject === 'control store' && entry.severity === 'error')
        .map((entry) => entry.message),
    ).toEqual([expect.stringContaining('the control store is not reachable')]);
    expect(result.found.some((entry) => entry.message.includes('never started'))).toBe(false);
    expect(result.stdout).not.toContain('WrongMadeUpWord');
    expect(result.code).toBe(1);
  });

  test('a lock on the migration history held elsewhere does not hold doctor: it returns, with the lock still held, an error that the store did not answer', async () => {
    const pg = createRequire(new URL('../../testing/package.json', import.meta.url))('pg');
    const admin = new pg.Client({ connectionString: postgres.adminUrl });
    await admin.connect();
    try {
      await admin.query('begin');
      await admin.query(`lock table "${controlRoot}".kw_migrations in access exclusive mode`);
      // The verdict is an order: doctor's deadline is stepped only once its read waits for the lock.
      const waiting = (async () => {
        for (;;) {
          const waits = await admin.query(
            `select 1 from pg_locks where not granted and relation = '"${controlRoot}".kw_migrations'::regclass`,
          );
          if (waits.rows.length > 0) return;
        }
      })();
      const result = await doctor([], postgres.appUrl, { stepTimers: waiting });
      expect(
        result.found
          .filter((entry) => entry.subject === 'control store' && entry.severity === 'error')
          .map((entry) => entry.message),
      ).toEqual([expect.stringContaining('no answer within the bound')]);
      expect(result.code).toBe(1);
    } finally {
      await admin.query('rollback');
      await admin.end();
    }
  });
});
