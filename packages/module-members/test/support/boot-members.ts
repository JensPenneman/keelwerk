import type { Logger, Scope } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
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
import { forgedApp } from './forged-app.ts';
import { heldApp } from './held-app.ts';
import { membersApp } from './members-app.ts';
import { resolverForgedApp } from './resolver-forged-app.ts';

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
  /**
   * Lets the kernel's job workers and the erasure worker run every step of the erasures requested
   * so far (section 14.7.5): the request job, the steps, and the jobs those leave.
   */
  settle(): Promise<void>;
  /** The records of the control ledger, oldest first: every erasure with its subject and requester. */
  ledger(): Promise<readonly { readonly record: Record<string, unknown> }[]>;
  /** What a subject's keys are in acme: whether a live key exists and how many were destroyed. */
  keysOf(subject: string): Promise<{ readonly live: boolean; readonly shredded: number }>;
  /**
   * The sealed values in the change records of an invitation or membership of acme, each with the
   * type of its record and whether its key can still be fetched, which is what opening it takes.
   */
  sealsOf(
    entity: 'invitation' | 'membership',
    id: string,
  ): Promise<readonly { readonly record: string; readonly openable: boolean }[]>;
  /** The invitations of a tenant as stored (acme unless named), erased ones left out. */
  invitations(
    tenant?: Tenant,
  ): Promise<readonly { readonly id: string; readonly status: string; readonly role: string }[]>;
  /** The keyed digest the store keeps of an invitation's address, as stored; PGlite only, undefined when none is kept. */
  digestOf(id: string): Promise<string | undefined>;
  /** The live memberships of a tenant with the owner role (acme unless named). */
  ownerCount(tenant?: Tenant): Promise<number>;
}

/** Boots the app with one backend and two tenants, acme and globex, on a clock the test moves. */
export async function bootMembers(
  kind: MembersStorage,
  options: Pick<TestRuntimeOptions, 'logger' | 'external'> & {
    readonly delivery?: boolean;
    readonly forged?: boolean;
    readonly resolverForged?: boolean;
    readonly held?: boolean;
  } = {},
): Promise<BootedMembers> {
  const app =
    options.resolverForged === true
      ? resolverForgedApp
      : options.forged === true
        ? forgedApp
        : options.held === true
          ? heldApp
          : options.delivery === true
            ? deliveryApp
            : membersApp;
  // The erasure worker runs its steps when a test asks (`settle`), never on a timer.
  const worker = erasure({ pollMs: 3_600_000 });
  // Both apps hold the members module and nothing a test reads of the other module, so the
  // runtime is typed as the one of `membersApp`.
  const runtime = (await startTestRuntime(app, {
    adapter: kind,
    tenants: ['acme', 'globex'],
    clock: { now: () => bootInstant },
    workers: true,
    eventWorkers: [worker],
    operators: true,
    ...(options.logger === undefined ? {} : { logger: options.logger as Logger }),
    ...(options.external === undefined ? {} : { external: options.external }),
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
    settle: async () => {
      await runtime.drainJobs();
      await worker.pass();
      await runtime.drainJobs();
    },
    ledger: () =>
      runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
        { readOnly: true },
      ) as Promise<readonly { readonly record: Record<string, unknown> }[]>,
    keysOf: (subject) =>
      runtime.adapter.unit(
        runtime.namespace,
        scope,
        async (unit) => ({
          live: (await unit.keys.dataKey(subject, { create: false })) !== undefined,
          shredded: (await unit.keys.shreddedKeys(subject)).length,
        }),
        { readOnly: true },
      ),
    sealsOf: (entity, id) =>
      runtime.adapter.unit(
        runtime.namespace,
        scope,
        async (unit) => {
          const events = await unit.events.readStream({ type: `members.${entity}`, id });
          const seals: { record: string; openable: boolean }[] = [];
          const walk = async (record: string, value: unknown): Promise<void> => {
            if (typeof value !== 'object' || value === null) return;
            if ('$kwe' in value && 'k' in value && typeof value.k === 'string') {
              seals.push({
                record,
                openable: (await unit.keys.keyById(value.k)) !== undefined,
              });
              return;
            }
            for (const member of Object.values(value)) await walk(record, member);
          };
          for (const event of events) await walk(event.type, event.data);
          return seals;
        },
        { readOnly: true },
      ),
    invitations: (tenant = 'acme') =>
      runtime.adapter.unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants[tenant].id },
        async (unit) => {
          const descriptor = runtime.app.registry.entities.get('members.invitation')?.descriptor;
          if (descriptor === undefined) throw new Error('no members.invitation');
          const page = await unit.rows.find(descriptor, { includeArchived: true });
          return page.rows.map((row) => ({
            id: String(row.id),
            status: String(row.status),
            role: String(row.role),
          }));
        },
        { readOnly: true },
      ),
    digestOf: async (id) => {
      const owner = runtime.adapter as unknown as {
        asOwner?: <T>(
          fn: (database: {
            query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
          }) => Promise<T>,
        ) => Promise<T>;
      };
      if (typeof owner.asOwner !== 'function') return undefined;
      const digest = await owner.asOwner<string | undefined>(async (database) => {
        const tables = await database.query(
          "select schemaname from pg_tables where tablename = 'members__invitation'",
        );
        for (const { schemaname } of tables.rows) {
          const found = await database.query(
            `select email__eq as digest from "${String(schemaname)}".members__invitation where id = $1`,
            [id],
          );
          const digest = found.rows[0]?.digest;
          if (digest !== null && digest !== undefined) return String(digest);
        }
        return undefined;
      });
      return digest;
    },
    ownerCount: (tenant = 'acme') =>
      runtime.sealed.unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants[tenant].id },
        async (unit) => {
          const descriptor = runtime.app.registry.entities.get('members.membership')?.descriptor;
          if (descriptor === undefined) throw new Error('no members.membership');
          const page = await unit.rows.find(descriptor, {
            where: { op: 'eq', field: 'role', value: 'owner' },
          });
          return page.rows.length;
        },
      ),
  };
}
