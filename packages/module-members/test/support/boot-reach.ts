import { defineApp, type ErasureRecord, type ErasureStep } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import {
  clientAddresses,
  createLocalClient,
  startTestRuntime,
  type TestRuntime,
  testOperator,
  testPrincipal,
} from '@keelwerk/testing';
import { members } from '../../src/module.generated.ts';
import { founder } from './member-calls.ts';

/** Accounts, auth and members together: the person's addresses are known, and invitations name them. */
const reachApp = defineApp({ id: 'reach-app', modules: [accounts, auth, members] as const });

type Tenant = 'acme' | 'globex';

/** Which of the modules that hold a person's address the app has: both, or one of them beside members. */
type ReachVariant = 'both' | 'auth' | 'accounts';

const variants = {
  both: { app: reachApp, config: { accounts: { allowSelfRegistration: true }, auth: {} } },
  auth: {
    app: defineApp({ id: 'reach-auth', modules: [auth, members] as const }),
    config: { auth: {} },
  },
  accounts: {
    app: defineApp({ id: 'reach-accounts', modules: [accounts, members] as const }),
    config: { accounts: { allowSelfRegistration: true } },
  },
};

/** The seams of the erasure worker a test arms. */
interface ReachSeams {
  afterStep?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
  insideStep?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
}

/** One pending or settled invitation as a test reads it: the address opened. */
interface InvitationView {
  readonly id: string;
  readonly status: string;
  readonly email: string | undefined;
}

/** Where the app is stored in a test. */
export type ReachStorage = 'memory' | 'pglite';

/** A person who signs up. */
export interface Person {
  readonly identifier: string;
  readonly password: string;
}
export const ada: Person = {
  identifier: 'ada@example.org',
  password: 'correct horse battery staple',
};
export const grace: Person = { identifier: 'grace@example.org', password: 'hopper-cobol-1959' };

export interface BootedReach {
  readonly runtime: TestRuntime<typeof reachApp, Tenant>;
  readonly seams: ReachSeams;
  /** Signs a person up in a tenant (acme unless named): a credential and a profile. */
  signUp(person: Person, tenant?: Tenant): Promise<void>;
  /** The person logs in and revokes her own credential: her identifier stays in the row, and another person may sign up with it (auth alone). */
  revokeCredential(person: Person, tenant?: Tenant): Promise<void>;
  /** The operator archives the profile of a subject (accounts present). */
  archiveProfile(subjectId: string, tenant?: Tenant): Promise<void>;
  /** The profile id of the person with this address, which is the person's subject. */
  subjectOf(address: string, tenant?: Tenant): Promise<string>;
  /** The founder invites an address in a tenant (acme unless named); answers the invitation's id and the token shown once. */
  invite(email: string, tenant?: Tenant): Promise<{ readonly id: string; readonly token: string }>;
  /** Whether a person presenting the token is accepted (the token of a live pending invitation) or refused. */
  accepts(token: string, tenant?: Tenant): Promise<boolean>;
  /** Whether a live data key of the subject exists in the tenant (acme unless named). */
  keyLive(subjectId: string, tenant?: Tenant): Promise<boolean>;
  /** The pending invitations of a tenant as stored, erased ones left out, addresses opened. */
  invitations(tenant?: Tenant): Promise<readonly InvitationView[]>;
  /** The operator asks the erasure of a subject in a tenant (acme unless named). */
  erase(subjectId: string, tenant?: Tenant): Promise<void>;
  /** Runs the request jobs and the erasure steps, and again what they left, until the control ledger stops growing. */
  settle(): Promise<void>;
  /** Runs the queued jobs: the request for an erasure becomes its record in the control ledger. */
  drain(): Promise<void>;
  /** One pass of the erasure worker over the records that are not finished, as after a crash. */
  pass(): Promise<number>;
  /** Whether the control ledger holds the completion of the erasure of the subject. */
  completed(subjectId: string): Promise<boolean>;
  /** The control ledger's erasure records, as subject ids with their reason. */
  erasures(): Promise<readonly { readonly subjectId: string; readonly reason: string }[]>;
}

/** Boots the app with one backend and two tenants, the founder the owner of each. */
export async function bootReach(
  kind: ReachStorage,
  variant: ReachVariant = 'both',
): Promise<BootedReach> {
  const seams: ReachSeams = {};
  const worker = erasure({
    pollMs: 3_600_000,
    afterStep: (step, record) => seams.afterStep?.(step, record) ?? Promise.resolve(),
    insideStep: (step, record) => seams.insideStep?.(step, record) ?? Promise.resolve(),
  });
  const runtime = (await startTestRuntime(variants[variant].app as typeof reachApp, {
    adapter: kind,
    tenants: ['acme', 'globex'],
    workers: true,
    // Auth's login record is an asynchronous reaction: the app needs a dispatcher, which these tests never step.
    eventWorkers: [
      worker,
      consumers({
        consumers: [reactionDispatcher()],
        runs: ['asyncReactions'],
        leaseMs: 86_400_000,
      }),
    ],
    operators: true,
    config: variants[variant].config,
  })) as unknown as TestRuntime<typeof reachApp, Tenant>;
  const nextAddress = clientAddresses();
  const scopeOf = (tenant: Tenant) =>
    ({
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants[tenant].id,
    }) as const;
  const operator = (tenant: Tenant) =>
    createLocalClient(runtime, { principal: testOperator(), tenant });
  const rowsOf = (entity: string, tenant: Tenant) =>
    runtime.sealed.unit(runtime.namespace, scopeOf(tenant), async (unit) => {
      const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
      if (descriptor === undefined) throw new Error(`no ${entity}`);
      return (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) })).rows;
    });
  const ledger = () =>
    runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
      { readOnly: true },
    );
  for (const tenant of ['acme', 'globex'] as const) {
    const created = await operator(tenant).attempt('members.invitation.createOwner', {
      email: 'founder@example.com',
    });
    if (!created.ok) throw created.error;
    const { token } = created.value as { token?: string };
    const accepted = await createLocalClient(runtime, { principal: founder, tenant }).attempt(
      'members.invitation.accept',
      { token: token ?? '' },
    );
    if (!accepted.ok) throw accepted.error;
  }
  /** One call of the app through its invoker, from a fresh remote address. */
  const call = (
    action: string,
    input: unknown,
    tenant: Tenant,
    headers: Record<string, string> = {},
  ) =>
    runtime.invoker.invoke({
      action,
      input,
      carrier: {
        transport: 'test',
        headers: { 'x-tenant': runtime.tenants[tenant].id, ...headers },
        connection: {
          id: 'c1',
          listener: 'http',
          remote: { address: nextAddress(), port: 40000 },
          local: { address: '127.0.0.1', port: 8080 },
        },
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    } as never) as unknown as Promise<{ ok: true; value: unknown } | { ok: false; error: Error }>;
  const booted: BootedReach = {
    runtime,
    seams,
    signUp: async (person, tenant = 'acme') => {
      if (variant === 'accounts') {
        const registered = await operator(tenant).attempt('accounts.register', {
          displayName: person.identifier,
          email: person.identifier,
        });
        if (!registered.ok) throw registered.error;
        return;
      }
      const done = await call('auth.signUp', person, tenant);
      if (!done.ok) throw done.error;
    },
    revokeCredential: async (person, tenant = 'acme') => {
      const login = await call('auth.login', person, tenant);
      if (!login.ok) throw login.error;
      const { sessionToken } = login.value as { sessionToken: string };
      const credential = (await rowsOf('auth.credential', tenant)).find(
        (row) => row.identifier === person.identifier && row.revokedAt == null,
      );
      if (credential === undefined) throw new Error(`no live credential for ${person.identifier}`);
      const revoked = await call(
        'auth.credential.revoke',
        { id: credential.id, reason: 'gone' },
        tenant,
        { authorization: `Bearer ${sessionToken}` },
      );
      if (!revoked.ok) throw revoked.error;
    },
    archiveProfile: async (subjectId, tenant = 'acme') => {
      const done = await operator(tenant).attempt('accounts.profile.archive', {
        id: subjectId as never,
      });
      if (!done.ok) throw done.error;
    },
    subjectOf: async (address, tenant = 'acme') => {
      if (variant === 'auth') {
        const credential = (await rowsOf('auth.credential', tenant)).find(
          (row) => row.identifier === address,
        );
        if (credential === undefined) throw new Error(`no credential for ${address}`);
        return String(credential.subject);
      }
      const profile = (await rowsOf('accounts.profile', tenant)).find(
        (row) => row.email === address,
      );
      if (profile === undefined) throw new Error(`no profile for ${address}`);
      return String(profile.id);
    },
    invite: async (email, tenant = 'acme') => {
      const done = await createLocalClient(runtime, { principal: founder, tenant }).attempt(
        'members.invitation.invite',
        { email, role: 'member' },
      );
      if (!done.ok) throw done.error;
      const { id, token } = done.value as { id: string; token?: string };
      return { id: String(id), token: token ?? '' };
    },
    accepts: async (token, tenant = 'acme') => {
      const done = await createLocalClient(runtime, {
        principal: testPrincipal('0192f3a0-0000-7000-8000-00000000f002'),
        tenant,
      }).attempt('members.invitation.accept', { token });
      return done.ok;
    },
    keyLive: (subjectId, tenant = 'acme') =>
      runtime.adapter.unit(
        runtime.namespace,
        scopeOf(tenant),
        async (unit) => (await unit.keys.dataKey(subjectId, { create: false })) !== undefined,
        { readOnly: true },
      ),
    invitations: async (tenant = 'acme') =>
      (await rowsOf('members.invitation', tenant))
        .filter((row) => row.status === 'pending')
        .map((row) => ({
          id: String(row.id),
          status: String(row.status),
          email: typeof row.email === 'string' ? row.email : undefined,
        })),
    erase: async (subjectId, tenant = 'acme') => {
      const done = await operator(tenant).attempt(
        'core.eraseSubject',
        { subjectId, reason: 'subjectRequest' } as never,
        { prefer: 'async' } as never,
      );
      if (!done.ok) throw done.error;
    },
    settle: async () => {
      for (let before = -1; before !== (await ledger()).length; ) {
        before = (await ledger()).length;
        await runtime.drainJobs();
        await worker.pass();
        await runtime.drainJobs();
      }
    },
    drain: async () => {
      await runtime.drainJobs();
    },
    pass: () => worker.pass(),
    completed: async (subjectId) =>
      (await ledger()).some(
        ({ record }) => record.type === 'erasureCompleted' && record.subjectId === subjectId,
      ),
    erasures: async () =>
      (await ledger()).flatMap(({ record }) =>
        record.type === 'erasure'
          ? [{ subjectId: record.subjectId, reason: String(record.reason) }]
          : [],
      ),
  };
  // Accepting the owner's invitation requested the erasure of its id: they run now, so a test starts on a quiet ledger.
  await booted.settle();
  return booted;
}
