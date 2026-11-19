import type { Logger, Scope } from '@keelwerk/core';
import {
  createLocalClient,
  dumpDatabase,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
  type TestRuntimeOptions,
  testOperator,
} from '@keelwerk/testing';
import { deliveryApp } from './delivery-app.ts';
import { membersApp } from './members-app.ts';

type Tenant = 'acme' | 'globex';

/** Where the app is stored in a test. */
export type MembersStorage = 'memory' | 'pglite';

/** The time every test starts at; `advanceTo` moves it. */
export const bootInstant = Temporal.Instant.from('2026-11-20T09:00:00Z');

/** What a booted app offers a test. */
export interface BootedMembers {
  readonly runtime: TestRuntime<typeof membersApp, Tenant>;
  /** The tenant scope of acme. */
  readonly scope: Scope;
  /** A local client of a tenant (acme unless named): a signed-in person. */
  as(
    principal: TestPrincipal,
    tenant?: Tenant,
  ): ReturnType<typeof createLocalClient<typeof membersApp>>;
  /** A local client of an operator who entered a tenant (acme unless named). */
  operator(tenant?: Tenant): ReturnType<typeof createLocalClient<typeof membersApp>>;
  /** The stored row of an entity of acme (`invitation` or `membership`), personal values opened. */
  row(
    entity: 'invitation' | 'membership',
    id: string,
  ): Promise<Record<string, unknown> | undefined>;
  /** Rewrites members of a stored row of acme, as a state no command makes (a test plants it). */
  plant(
    entity: 'invitation' | 'membership',
    id: string,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  /** The receipt of a command of acme, or undefined. */
  receipt(
    commandId: string,
  ): Promise<{ readonly status: string; readonly outcome?: unknown } | undefined>;
  /** Every table of the database as text, for a search for plain values. PGlite only. */
  dumpOf(): Promise<string>;
  /** Destroys the data keys of a subject of acme, as the erasure worker does at its end. */
  shred(subject: string): Promise<void>;
}

/** Boots the app with one backend and two tenants, acme and globex, on a clock the test moves. */
export async function bootMembers(
  kind: MembersStorage,
  options: Pick<TestRuntimeOptions, 'logger' | 'external'> & { readonly delivery?: boolean } = {},
): Promise<BootedMembers> {
  const app = options.delivery === true ? deliveryApp : membersApp;
  const runtime = (await startTestRuntime(app, {
    adapter: kind,
    tenants: ['acme', 'globex'],
    clock: { now: () => bootInstant },
    workers: true,
    operators: true,
    ...(options.logger === undefined ? {} : { logger: options.logger as Logger }),
    ...(options.external === undefined ? {} : { external: options.external }),
    // Both apps hold the members module and nothing a test reads of the other module.
  })) as unknown as TestRuntime<typeof membersApp, Tenant>;
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  return {
    runtime,
    scope,
    as: (principal, tenant = 'acme') => createLocalClient(runtime, { principal, tenant }),
    operator: (tenant = 'acme') =>
      createLocalClient(runtime, { principal: testOperator(), tenant }),
    row: (entity, id) =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const descriptor = runtime.app.registry.entities.get(`members.${entity}`)?.descriptor;
        if (descriptor === undefined) throw new Error(`no members.${entity}`);
        return unit.rows.findOne(descriptor, {
          where: { op: 'eq', field: 'id', value: id },
          select: Object.keys(descriptor.fields),
        });
      }),
    plant: (entity, id, patch) =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const descriptor = runtime.app.registry.entities.get(`members.${entity}`)?.descriptor;
        if (descriptor === undefined) throw new Error(`no members.${entity}`);
        const row = await unit.rows.findOne(descriptor, {
          where: { op: 'eq', field: 'id', value: id },
          select: Object.keys(descriptor.fields),
        });
        if (row === undefined) throw new Error(`no row ${id}`);
        const version = Number(row.version);
        await unit.rows.update(descriptor, [
          // The version stays: no event moved the stream, so the next command reads it as it was.
          { id, expectedVersion: version, values: { ...row, ...patch, version } },
        ]);
      }),
    receipt: (commandId) =>
      runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.receipts.get(commandId)),
    dumpOf: async () => {
      const owner = runtime.adapter;
      if (!('asOwner' in owner) || typeof owner.asOwner !== 'function') {
        throw new Error('the PGlite adapter has no owner connection');
      }
      const asOwner = owner.asOwner.bind(owner) as (
        fn: (database: {
          query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
        }) => Promise<string>,
      ) => Promise<string>;
      return asOwner((database) => dumpDatabase(async (sql) => (await database.query(sql)).rows));
    },
    shred: async (subject) => {
      await runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
        await unit.keys.shred(subject);
      });
    },
  };
}
