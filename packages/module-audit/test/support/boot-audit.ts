import { defineApp, type Unit } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher, retention } from '@keelwerk/events';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import { members } from '@keelwerk/module-members';
import {
  clientAddresses,
  createLocalClient,
  settleReactions,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
  type TestRuntimeOptions,
  testOperator,
} from '@keelwerk/testing';
import { audit } from '../../src/module.generated.ts';
import { auditNotes } from './notes-module.ts';
import { adaUser, graceUser } from './people.ts';
import { roleForger } from './role-forger.ts';

type Tenant = 'acme' | 'globex';

/** What a request carries besides its input. */
interface Carrier {
  readonly headers?: Readonly<Record<string, string>>;
  /** The test principal the request is made as; none makes an anonymous request. */
  readonly principal?: TestPrincipal;
  readonly commandId?: string;
  readonly tenant?: Tenant;
}

/** The header the test runtime's principal resolver reads (the local client sets it for every call). */
const principalHeader = 'x-test-principal';

/**
 * A deployment's policy override that allows every action of audit.entry to operators: what the deny
 * rule `audit.entry.noWrites` has to hold against.
 */
const allowEveryEntryAction = {
  id: 'audit.entry.overrideAll',
  module: 'audit',
  effect: 'allow',
  subject: { module: 'audit', entity: 'entry' },
  actions: ['*'],
  principal: 'operator',
  reason: 'A deployment lets operators do everything with the entries.',
  disabled: false,
} as const;

/** Notes and audit: an event for the observer to see, over the test principals. */
export const aloneApp = defineApp({ id: 'alone', modules: [auditNotes, audit] as const });
/** `aloneApp` with the members module: the cases about a tenant's admin and owner. */
export const membersApp = defineApp({
  id: 'alone',
  modules: [auditNotes, members, audit] as const,
}) as unknown as typeof aloneApp;
/** `aloneApp` with a module that gives people admin and owner as words or as memberships of its own kind (no members module). */
export const forgedApp = defineApp({
  id: 'alone',
  modules: [auditNotes, roleForger, audit] as const,
}) as unknown as typeof aloneApp;
/** Accounts and auth with audit: a sign-up, a login and a profile change over requests. */
export const withAccountsApp = defineApp({
  id: 'with-accounts',
  modules: [accounts, auth, audit] as const,
});

/** `aloneApp` with that override. */
export const overriddenAloneApp = defineApp({
  id: 'alone',
  modules: [auditNotes, members, audit] as const,
  policies: { add: [allowEveryEntryAction] },
}) as unknown as typeof aloneApp;
/** `withAccountsApp` with that override. */
export const overriddenAccountsApp: typeof withAccountsApp = defineApp({
  id: 'with-accounts',
  modules: [accounts, auth, audit] as const,
  policies: { add: [allowEveryEntryAction] },
});

export type AuditStorage = 'memory' | 'pglite';
/** The time every test starts at. */
export const auditBootedAt = Temporal.Instant.from('2026-11-19T09:00:00Z');

/** A booted app and the ways to reach it. */
export interface BootedAudit<App extends typeof aloneApp | typeof withAccountsApp> {
  readonly runtime: TestRuntime<App>;
  readonly erasure: ReturnType<typeof erasure>;
  readonly retention: ReturnType<typeof retention>;
  /** Dispatches the reactions and runs the jobs until nothing is left. */
  settle(): Promise<void>;
  /** A local client of a tenant (acme unless named). */
  client(principal: TestPrincipal, tenant?: Tenant): ReturnType<typeof createLocalClient<App>>;
  /**
   * Seats grace as the owner and ada as an admin (or a plain member) of a tenant (acme unless named) through the
   * members module's own actions: an operator invites the owner, who accepts and invites the
   * admin, who accepts. `entries` and `own` leave the entries of those events out.
   */
  seat(tenant?: Tenant, adminRole?: 'admin' | 'member'): Promise<void>;
  /** What a reader's page holds without the entries of the seating. */
  own<T extends { readonly eventId: unknown }>(items: readonly T[]): T[];
  /** An operator client of a tenant (acme unless named). */
  operator(tenant?: Tenant): ReturnType<typeof createLocalClient<App>>;
  /** Invokes an action as a request from a fresh client address, carrying these headers and, when given, as this principal. */
  request(
    action: string,
    input: unknown,
    carrier?: Carrier,
  ): ReturnType<TestRuntime<App>['invoker']['invoke']>;
  /** The entries of a tenant as the kernel opens them: personal values readable. */
  entries(tenant?: Tenant): Promise<readonly Readonly<Record<string, unknown>>[]>;
  /** The entries of a tenant as the store holds them: personal values sealed; erased tombstones with `includeErased`. */
  rawEntries(
    tenant?: Tenant,
    options?: { readonly includeErased?: boolean },
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  /** Runs `fn` in a unit of a tenant over the placement the kernel sees. */
  inUnit<T>(fn: (unit: Unit) => Promise<T>, tenant?: Tenant): Promise<T>;
  /** Erases a data subject of acme as an operator and lets the jobs and the erasure worker run to the end. */
  erase(subject: string): Promise<void>;
}

/** Boots an app with audit, one backend and two tenants, on a clock the test moves. */
export async function bootAudit<App extends typeof aloneApp | typeof withAccountsApp>(
  app: App,
  kind: AuditStorage,
  external?: TestRuntimeOptions['external'],
): Promise<BootedAudit<App>> {
  const dispatcher = consumers({
    consumers: [reactionDispatcher()],
    runs: ['asyncReactions'],
    leaseMs: 86_400_000,
  });
  const erasing = erasure({ pollMs: 3_600_000 });
  const retaining = retention();
  const runtime = (await startTestRuntime(app, {
    adapter: kind,
    operators: true,
    tenants: ['acme', 'globex'],
    clock: { now: () => auditBootedAt },
    workers: true,
    ...(external === undefined ? {} : { external }),
    eventWorkers: [dispatcher, erasing, retaining],
    ...(app.modules.some((module) => module.id === 'accounts')
      ? { config: { accounts: { allowSelfRegistration: true }, auth: {} } }
      : {}),
  })) as unknown as TestRuntime<App>;
  const nextAddress = clientAddresses();
  const seated = new Set<string>();
  const tenantId = (tenant: Tenant): string => {
    const found = runtime.tenants[tenant];
    if (found === undefined) throw new Error(`no tenant ${tenant}`);
    return found.id;
  };
  const scopeOf = (tenant: Tenant) =>
    ({
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: tenantId(tenant),
    }) as const;
  const entriesOf = (adapter: TestRuntime<App>['adapter'], tenant: Tenant, includeErased = false) =>
    adapter.unit(runtime.namespace, scopeOf(tenant), async (unit) => {
      const descriptor = runtime.app.registry.entities.get('audit.entry')?.descriptor;
      if (descriptor === undefined) throw new Error('no audit.entry');
      return (
        await unit.rows.find(descriptor, {
          select: Object.keys(descriptor.fields),
          ...(includeErased ? { includeErased: true, includeArchived: true } : {}),
        })
      ).rows;
    });
  return {
    runtime,
    erasure: erasing,
    retention: retaining,
    settle: () => settleReactions(dispatcher, runtime.drainJobs),
    client: (principal, tenant = 'acme') => createLocalClient(runtime, { principal, tenant }),
    operator: (tenant = 'acme') =>
      createLocalClient(runtime, { principal: testOperator(), tenant }),
    seat: async (tenant = 'acme', adminRole = 'admin') => {
      const before = new Set(
        (await entriesOf(runtime.sealed, tenant)).map((row) => String(row.eventId)),
      );
      const as = (principal: TestPrincipal) =>
        createLocalClient(runtime, { principal, tenant }) as unknown as {
          invoke(action: string, input: unknown): Promise<{ readonly token?: string }>;
        };
      const owner = await as(testOperator()).invoke('members.invitation.createOwner', {
        email: 'grace@seat.example',
      });
      await as(graceUser).invoke('members.invitation.accept', { token: owner.token });
      const admin = await as(graceUser).invoke('members.invitation.invite', {
        email: 'ada@seat.example',
        role: adminRole,
      });
      await as(adaUser).invoke('members.invitation.accept', { token: admin.token });
      await settleReactions(dispatcher, runtime.drainJobs);
      for (const row of await entriesOf(runtime.sealed, tenant)) {
        if (!before.has(String(row.eventId))) seated.add(String(row.eventId));
      }
    },
    own: (items) => items.filter((item) => !seated.has(String(item.eventId))),
    request: (action, input, carrier = {}) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: {
          transport: 'test',
          headers: {
            'x-tenant': tenantId(carrier.tenant ?? 'acme'),
            ...(carrier.principal === undefined
              ? {}
              : { [principalHeader]: JSON.stringify(carrier.principal) }),
            ...carrier.headers,
          },
          connection: {
            id: 'c1',
            listener: 'http',
            remote: { address: nextAddress(), port: 40000 },
            local: { address: '127.0.0.1', port: 8080 },
          },
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        ...(carrier.commandId === undefined ? {} : { commandId: carrier.commandId }),
      }),
    entries: async (tenant = 'acme') =>
      (await entriesOf(runtime.sealed, tenant)).filter((row) => !seated.has(String(row.eventId))),
    rawEntries: async (tenant = 'acme', options = {}) =>
      (await entriesOf(runtime.adapter, tenant, options.includeErased)).filter(
        (row) => !seated.has(String(row.eventId)),
      ),
    inUnit: (fn, tenant = 'acme') => runtime.sealed.unit(runtime.namespace, scopeOf(tenant), fn),
    erase: async (subject) => {
      await createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' }).invoke(
        'core.eraseSubject' as never,
        { subjectId: subject, reason: 'subjectRequest' } as never,
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await erasing.pass();
      await settleReactions(dispatcher, runtime.drainJobs);
    },
  };
}
