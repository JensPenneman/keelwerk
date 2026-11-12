import { defineApp, type Unit } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import {
  clientAddresses,
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
} from '@keelwerk/testing';
import { library } from '@keelwerk/testing/fixtures';
import { apiKeys } from '../../src/module.generated.ts';
import { bootedAt, type KeysStorage } from './boot-api-keys.ts';
import { later } from './later/module.ts';

/** The tenant acme's scope and the key entity's descriptor, for tests that read or seed the store. */
function keyStoreOf(app: BootedOwnerApp) {
  const { runtime } = app;
  const descriptor = runtime.app.registry.entities.get('api-keys.key')?.descriptor;
  if (descriptor === undefined) throw new Error('no api-keys.key');
  const tenant = runtime.tenants.acme;
  if (tenant === undefined) throw new Error('no tenant acme');
  const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id } as const;
  return {
    descriptor,
    run: <T>(fn: (unit: Unit) => Promise<T>) => runtime.sealed.unit(runtime.namespace, scope, fn),
  };
}

/** A session of a person: what `auth.login` answers. */
interface OwnerSession {
  readonly sessionToken: string;
  readonly sessionId: string;
}

/** The modules a person signs in with, their keys, and a module with work to queue. */
const ownerApp = defineApp({
  id: 'owner-sign-in',
  modules: [accounts, auth, apiKeys, library, later] as const,
});

/** A booted app of accounts, auth and api-keys. */
export interface BootedOwnerApp {
  readonly runtime: TestRuntime<typeof ownerApp>;
  /** Invokes an action presenting a bearer token (a session's or a key's), or none. */
  request(
    action: string,
    input: unknown,
    token?: string,
  ): ReturnType<TestRuntime<typeof ownerApp>['invoker']['invoke']>;
  /** A local client of the tenant acme for a principal (an operator when the principal claims it). */
  client(principal: TestPrincipal): ReturnType<typeof createLocalClient<typeof ownerApp>>;
  /** The id of the one profile of the tenant. */
  profileId(): Promise<string>;
}

/** Boots the app with the tenant acme, accounts open to self-registration, on a clock the test moves. */
export async function bootOwnerApp(kind: KeysStorage): Promise<BootedOwnerApp> {
  const runtime = await startTestRuntime(ownerApp, {
    adapter: kind,
    tenants: ['acme'],
    operators: true,
    workers: true,
    clock: { now: () => bootedAt },
    config: { accounts: { allowSelfRegistration: true } },
  });
  const nextAddress = clientAddresses();
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  return {
    runtime,
    request: (action, input, token) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: {
          transport: 'test',
          headers: {
            'x-tenant': runtime.tenants.acme.id,
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
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
      }),
    client: (principal) => createLocalClient(runtime, { principal, tenant: 'acme' }),
    profileId: () =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const descriptor = runtime.app.registry.entities.get('accounts.profile')?.descriptor;
        if (descriptor === undefined) throw new Error('no accounts.profile');
        const { rows } = await unit.rows.find(descriptor, { select: ['id'] });
        return String(rows[0]?.id);
      }),
  };
}

/** The person the tests sign up. */
export const ownerPerson = {
  identifier: 'ownerPerson@example.org',
  password: 'correct horse battery staple',
};

/** What `enrolOwner` leaves: a signed-up person with a session and a write key made with it. */
export interface EnrolledOwner {
  readonly credentialId: string;
  readonly session: OwnerSession;
  readonly key: string;
  readonly keyId: string;
  /** Logs the person in again. */
  login(): Promise<OwnerSession>;
}

/** Signs ownerPerson up, logs her in and makes a key with the given scopes (write unless named) with the session. */
export async function enrolOwner(
  app: BootedOwnerApp,
  scopes: readonly string[] = ['write'],
): Promise<EnrolledOwner> {
  const signedUp = await app.request('auth.signUp', ownerPerson);
  if (!signedUp.ok) throw signedUp.error;
  const login = async (): Promise<OwnerSession> => {
    const done = await app.request('auth.login', ownerPerson);
    if (!done.ok) throw done.error;
    return done.value as OwnerSession;
  };
  const session = await login();
  const created = await app.request(
    'api-keys.create',
    { label: 'script', scopes },
    session.sessionToken,
  );
  if (!created.ok) throw created.error;
  const { key, id } = created.value as { key: string; id: string };
  return {
    credentialId: (signedUp.value as { credentialId: string }).credentialId,
    session,
    key,
    keyId: id,
    login,
  };
}

/**
 * Stores `count` more unrevoked keys for the owner of the key `keyId`, copies of its row with new
 * ids and public ids. `create` refuses a person's hundred-and-first key, so a person who holds more
 * is built in the store, as keys issued before the limit would be.
 */
export async function seedKeys(app: BootedOwnerApp, keyId: string, count: number): Promise<void> {
  const { descriptor, run } = keyStoreOf(app);
  await run(async (unit) => {
    const template = await unit.rows.findOne(descriptor, {
      where: { op: 'eq', field: 'id', value: keyId },
      select: Object.keys(descriptor.fields),
    });
    if (template === undefined) throw new Error('no key row to copy');
    await unit.rows.insert(
      descriptor,
      Array.from({ length: count }, () => ({
        ...template,
        id: crypto.randomUUID(),
        publicId: crypto.randomUUID(),
        version: 0,
      })),
    );
  });
}

/** How many keys of the tenant are not revoked. */
export function liveKeyCount(app: BootedOwnerApp): Promise<number> {
  const { descriptor, run } = keyStoreOf(app);
  return run((unit) =>
    unit.rows.count(descriptor, { op: 'isNull', field: 'revokedAt', value: true }),
  );
}
