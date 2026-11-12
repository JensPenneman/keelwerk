import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { Scope, StorageRow, Unit } from '@keelwerk/core';
import { consumers, reactionDispatcher } from '@keelwerk/events';
import pg from 'pg';
import { afterEach, beforeEach } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import { createTestDatabase } from '../../support/create-test-database.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';

export type RestartRuntime = TestRuntime<typeof erasureDumpApp>;

/** The tenant scope of the first tenant of a runtime. */
export const scopeOf = (runtime: RestartRuntime): Scope => ({
  level: 'tenant',
  backendId: runtime.backendId,
  tenantId: runtime.tenants.acme?.id ?? '',
});

/** The rows of an entity as the kernel reads them: archived and erased ones too. */
export function kernelRows(runtime: RestartRuntime, ref: string): Promise<readonly StorageRow[]> {
  const descriptor = runtime.app.registry.entities.get(ref)?.descriptor;
  if (descriptor === undefined) throw new Error(`no entity ${ref}`);
  return runtime.adapter.unit(
    runtime.namespace,
    scopeOf(runtime),
    async (unit) =>
      (await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })).rows,
    { readOnly: true },
  );
}

/**
 * A `probe.thread` row of `subject` and its created event, written without the sealing unit (as
 * before the fence existed): no key was ever made for the subject.
 */
export async function insertUnfencedThread(
  runtime: RestartRuntime,
  subject: string,
): Promise<void> {
  const descriptor = runtime.app.registry.entities.get('probe.thread')?.descriptor;
  if (descriptor === undefined) throw new Error('no probe.thread');
  const at = Temporal.Now.instant();
  const id = crypto.randomUUID();
  const values = { id, title: 'old', ownerId: subject };
  await runtime.adapter.unit(runtime.namespace, scopeOf(runtime), async (unit) => {
    await unit.rows.insert(descriptor, [{ ...values, createdAt: at, updatedAt: at, version: 1 }]);
    await unit.events.append([
      {
        stream: { type: 'probe.thread', id },
        expectedVersion: 0,
        partition: null,
        events: [
          {
            eventId: crypto.randomUUID(),
            name: 'created',
            schemaVersion: 1,
            shape: descriptor.shape.id,
            data: values,
            before: null,
            hlc: '0' as never,
            recordedAt: at,
            meta: {
              actor: { kind: 'operator', id: null, via: 'test' },
              commandId: crypto.randomUUID(),
              action: 'probe.open',
              causationId: null,
              correlationId: crypto.randomUUID(),
              client: null,
              merge: null,
              traceparent: null,
              writer: { build: 'test', revision: 0 },
              flags: [],
              decision: null,
            },
            transient: false,
            prevHash: null,
            hash: null,
          },
        ],
      },
    ]);
  });
}

/**
 * What the erasure tests on PostgreSQL share: a database of its own for each case (a deployment
 * creates its backend once), the clients and runtimes the case opened are closed after it.
 */
export function useRestartDatabase() {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  const stops: (() => Promise<void>)[] = [];
  let counter = 0;
  beforeEach(async () => {
    counter += 1;
    urls = await createTestDatabase(
      `erasure_restart_${counter}_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`,
    );
  }, 120_000);
  afterEach(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  });

  const inTenant = <T>(runtime: RestartRuntime, fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(runtime.namespace, scopeOf(runtime), fn);
  return {
    stops,
    external: () => ({
      factory: postgresAdapter({ ownerUrl: urls.adminUrl }),
      url: urls.appUrl,
    }),
    dispatcher: () => consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
    async owner(): Promise<pg.Client> {
      const client = new pg.Client({ connectionString: urls.adminUrl });
      await client.connect();
      stops.push(() => client.end());
      return client;
    },
    async seedAda(runtime: RestartRuntime) {
      const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
      const ada = String(
        (
          (await operator.invoke('probe.enrol', {
            name: 'Ada',
            email: 'restart.ada@example.test',
          })) as { personId: string }
        ).personId,
      );
      return { operator, ada };
    },
    inTenant,
    personRows: (runtime: RestartRuntime) =>
      inTenant(runtime, async (unit) => {
        const entry = runtime.app.registry.entities.get('probe.person');
        if (entry === undefined) throw new Error('no probe.person');
        return (await unit.rows.find(entry.descriptor, { includeArchived: true })).rows;
      }),
    joined: (runtime: RestartRuntime) => ({
      backendId: runtime.backendId,
      tenants: {
        acme: runtime.tenants.acme?.id ?? '',
        globex: runtime.tenants.globex?.id ?? '',
      },
    }),
  };
}
