import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { Logger, ScopeMark } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import { libraryApp } from '../../src/fixtures/index.ts';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { execInContainer } from '../../src/postgres/index.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { memorySink } from './support/memory-sink.ts';

// A restore as an operator makes it: `pg_dump -Fc -n <schema>` of the placement's schema, and
// `pg_restore --clean --if-exists` of it later. The control store (another schema) keeps what it
// has, as it does when only the application's cluster is restored. The project's shared cluster
// serves it: each test gets a database of its own, and the image's client tools run inside the
// shared container.
describe('a placement dumped and restored on PostgreSQL (14.7.6)', () => {
  const postgres = inject('postgresCluster');
  let counter = 0;
  let urls: { readonly adminUrl: string; readonly appUrl: string; readonly name: string };
  const stops: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    counter += 1;
    const name = `restore_${counter}_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const admin = new pg.Client({ connectionString: postgres.adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${name}`);
    } finally {
      await admin.end();
    }
    const at = (url: string): string => {
      const parsed = new URL(url);
      parsed.pathname = `/${name}`;
      return parsed.toString();
    };
    urls = { adminUrl: at(postgres.adminUrl), appUrl: at(postgres.appUrl), name };
  }, 120_000);
  afterEach(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
    const admin = new pg.Client({ connectionString: postgres.adminUrl });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${urls.name} with (force)`);
    } finally {
      await admin.end();
    }
  });

  const external = () => ({
    factory: postgresAdapter({ ownerUrl: urls.adminUrl }),
    url: urls.appUrl,
  });

  /** Dumps the schema inside the container and answers a function that puts it back. */
  async function backUp(schema: string, name: string) {
    const file = `/tmp/${urls.name}-${name}`;
    const user = new URL(postgres.adminUrl).username;
    const dumped = await execInContainer(postgres.containerId, [
      'pg_dump',
      '-Fc',
      '-U',
      user,
      '-d',
      urls.name,
      '-n',
      schema,
      '-f',
      file,
    ]);
    expect(dumped.exitCode, dumped.output).toBe(0);
    return async (): Promise<void> => {
      const restored = await execInContainer(postgres.containerId, [
        'pg_restore',
        '--clean',
        '--if-exists',
        '-U',
        user,
        '-d',
        urls.name,
        file,
      ]);
      expect(restored.exitCode, restored.output).toBe(0);
    };
  }

  test('the image carries pg_dump and pg_restore', async () => {
    for (const tool of ['pg_dump', 'pg_restore']) {
      const answer = await execInContainer(postgres.containerId, [tool, '--version']);
      expect(answer.exitCode, answer.output).toBe(0);
      expect(answer.output).toContain('18');
    }
  });

  describe('a library placement', () => {
    type Library = TestRuntime<typeof libraryApp, 'acme'>;
    const warned: string[] = [];
    const logger: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (message) => {
        warned.push(message);
      },
      error: () => undefined,
      child: () => logger,
    };
    const boot = async (join?: { backendId: string; tenants: Record<string, string> }) => {
      const runtime = await startTestRuntime(libraryApp, {
        external: external(),
        tenants: ['acme'],
        logger,
        ...(join === undefined ? {} : { join }),
      });
      stops.push(() => runtime.stop(1000));
      return runtime;
    };
    const ada = (runtime: Library) =>
      createLocalClient(runtime, { principal: testPrincipal('ada') });
    const stateOf = async (runtime: Library): Promise<string> =>
      String(
        (
          (await ada(runtime).invoke('library.book.get' as never, { ids: [] } as never)) as {
            state: string;
          }
        ).state,
      );
    const headOf = (runtime: Library): Promise<bigint> =>
      runtime.adapter.unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id },
        async (unit) => (await unit.events.head()) ?? 0n,
        { readOnly: true },
      );
    const bumped = (runtime: Library): Promise<readonly ScopeMark[]> =>
      runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        async (unit) => unit.marks?.bumped() ?? [],
        { readOnly: true },
      );

    test('dump, write, stop, restore, start: the restore is detected, the epochs move, an old token resets and no position is reused', {
      timeout: 300_000,
    }, async () => {
      const first = await boot();
      await ada(first).invoke('library.addBook', { title: 'One', isbn: '1' });
      const restore = await backUp(first.namespace.root, 'placement.dump');
      await ada(first).invoke('library.addBook', { title: 'Two', isbn: '2' });
      await ada(first).invoke('library.addBook', { title: 'Three', isbn: '3' });
      const token = await stateOf(first);
      const before = await headOf(first);
      const ids = { backendId: first.backendId, tenants: { acme: first.tenants.acme.id } };
      // The stop records the marks once more, so they stand at the head the writes reached.
      await first.stop(1000);
      stops.length = 0;
      warned.length = 0;

      await restore();
      const again = await boot(ids);
      expect(warned.some((message) => message.includes('a restore was detected'))).toBe(true);
      const marks = await bumped(again);
      expect(marks.find((mark) => mark.scopeId === ids.tenants.acme)?.epoch).toBe(2);
      expect(
        await ada(again).invoke('library.book.changes' as never, { since: token } as never),
      ).toMatchObject({ cannotCalculateChanges: true, reason: 'epoch' });
      await ada(again).invoke('library.addBook', { title: 'Four', isbn: '4' });
      expect(await headOf(again)).toBeGreaterThan(before);
    });
  });

  describe('the erasure probe', () => {
    type Probe = TestRuntime<typeof erasureDumpApp>;
    const dispatcher = () =>
      consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
    const email = 'restore.ada@example.test';
    const boot = async (options: {
      readonly sink: ReturnType<typeof memorySink>;
      readonly worker?: ReturnType<typeof erasure>;
      readonly join?: { backendId: string; tenants: Record<string, string> };
    }) => {
      const runtime = await startTestRuntime(erasureDumpApp, {
        external: external(),
        operators: true,
        workers: true,
        ledgers: [options.sink],
        ...(options.join === undefined ? {} : { join: options.join }),
        eventWorkers: [dispatcher(), ...(options.worker === undefined ? [] : [options.worker])],
      });
      stops.push(() => runtime.stop(1000));
      return runtime;
    };
    const operatorOf = (runtime: Probe) =>
      createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const joinOf = (runtime: Probe) => ({
      backendId: runtime.backendId,
      tenants: { acme: runtime.tenants.acme?.id ?? '', globex: runtime.tenants.globex?.id ?? '' },
    });
    const personByEmail = (runtime: Probe) =>
      runtime.sealed.unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme?.id ?? '' },
        async (unit) => {
          const entry = runtime.app.registry.entities.get('probe.person');
          if (entry === undefined) throw new Error('no probe.person');
          return (
            await unit.rows.find(entry.descriptor, {
              where: { op: 'eq', field: 'email', value: email },
              includeArchived: true,
              includeErased: true,
            })
          ).rows.filter((row) => row.kwErasedAt === undefined || row.kwErasedAt === null);
        },
      );
    const enrol = async (runtime: Probe): Promise<string> =>
      String(
        (
          (await operatorOf(runtime).invoke('probe.enrol', { name: 'Ada', email })) as {
            personId: string;
          }
        ).personId,
      );
    const erase = async (runtime: Probe, ada: string): Promise<void> => {
      await operatorOf(runtime).invoke(
        'core.eraseSubject',
        { subjectId: ada as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await runtime.drainJobs();
    };
    const completions = async (runtime: Probe): Promise<number[]> =>
      (
        await runtime.control.adapter.unit(
          runtime.control.namespace,
          { level: 'deployment' },
          (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
          { readOnly: true },
        )
      ).flatMap((entry) => (entry.record.type === 'erasureCompleted' ? [entry.record.epoch] : []));

    test('a backup taken between the shred and the completion: the erasure runs again before the tenant serves, and no lookup by the erased value finds a row', {
      timeout: 300_000,
    }, async () => {
      const sink = memorySink();
      let restore: (() => Promise<void>) | undefined;
      let schema = '';
      const worker = erasure({
        pollMs: 3_600_000,
        afterStep: async (step) => {
          if (step === 'shred' && schema !== '') restore = await backUp(schema, 'between.dump');
        },
      });
      const first = await boot({ sink, worker });
      schema = first.namespace.root;
      const ada = await enrol(first);
      await erase(first, ada);
      await worker.pass();
      expect(restore).toBeDefined();
      expect(await completions(first)).toEqual([0]);
      const ids = joinOf(first);
      await first.stop(1000);
      stops.length = 0;

      await restore?.();
      // A runtime without the erasure worker: the tenant is held until the erasure has run again.
      const held = await boot({ sink, join: ids });
      const refused = await operatorOf(held).attempt('probe.enrol', {
        name: 'Bea',
        email: 'restore.bea@example.test',
      });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatchObject({ code: 'core.unavailable' });
      // A second runtime that starts after the first, with no completion yet, holds the tenant too.
      const second = await boot({ sink, join: ids });
      const alsoRefused = await operatorOf(second).attempt('probe.enrol', {
        name: 'Cy',
        email: 'restore.cy@example.test',
      });
      expect(alsoRefused.ok).toBe(false);
      if (!alsoRefused.ok) expect(alsoRefused.error).toMatchObject({ code: 'core.unavailable' });
      await Promise.all([held.stop(1000), second.stop(1000)]);
      stops.length = 0;

      const worker2 = erasure({ pollMs: 3_600_000 });
      const served = await boot({ sink, worker: worker2, join: ids });
      await worker2.pass();
      expect(await personByEmail(served)).toEqual([]);
      expect((await completions(served)).at(-1)).toBe(2);
    });

    test('an erasure made after the dump is applied again after the restore', {
      timeout: 300_000,
    }, async () => {
      const sink = memorySink();
      const worker = erasure({ pollMs: 3_600_000 });
      const first = await boot({ sink, worker });
      const ada = await enrol(first);
      const restore = await backUp(first.namespace.root, 'before.dump');
      await erase(first, ada);
      await worker.pass();
      expect(await personByEmail(first)).toEqual([]);
      const ids = joinOf(first);
      await first.stop(1000);
      stops.length = 0;

      await restore();
      const worker2 = erasure({ pollMs: 3_600_000 });
      const again = await boot({ sink, worker: worker2, join: ids });
      await worker2.pass();
      expect(await personByEmail(again)).toEqual([]);
      expect(await completions(again)).toEqual([0, 2]);
    });
  });
});
