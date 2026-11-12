import { defineApp, type Unit } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import {
  clientAddresses,
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
} from '@keelwerk/testing';
import { auth } from '../../src/module.generated.ts';
import { type HandClock, handClock, type StorageKind } from './boot-auth.ts';
import { mailbox } from './mailbox/module.ts';

/** Accounts and auth together, with a test mailbox that fills auth's reset delivery, as an app. */
const bothApp = defineApp({ id: 'both', modules: [accounts, auth, mailbox] as const });

/** A booted app of both modules and the ways to reach it. */
export interface BootedBoth {
  readonly runtime: TestRuntime<typeof bothApp>;
  readonly clock: HandClock;
  /** A local client of the acme tenant. */
  client(principal: TestPrincipal): ReturnType<typeof createLocalClient<typeof bothApp>>;
  /** Runs `fn` in a unit of the acme tenant over the raw store (sealed values stay sealed) or, with `sealed`, over the placement the kernel sees. */
  inUnit<T>(fn: (unit: Unit) => Promise<T>, options?: { readonly sealed?: boolean }): Promise<T>;
  /** The rows of an entity as the store holds them, or opened with `sealed`. */
  rows(
    entity: string,
    options?: { readonly sealed?: boolean },
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  /** Invokes an action as a request that carries these headers (a cookie or a bearer token). */
  request(
    action: string,
    input: unknown,
    carrier?: {
      readonly headers?: Readonly<Record<string, string>>;
      readonly commandId?: string;
    },
  ): ReturnType<TestRuntime<typeof bothApp>['invoker']['invoke']>;
}

/** Boots accounts and auth with one backend and the tenant acme, on a clock the test moves. */
export async function bootBoth(
  kind: StorageKind,
  settings: {
    readonly accounts?: Readonly<Record<string, unknown>>;
    readonly auth?: Readonly<Record<string, unknown>>;
  } = {},
): Promise<BootedBoth> {
  const clock = handClock();
  const runtime = await startTestRuntime(bothApp, {
    adapter: kind,
    operators: true,
    tenants: ['acme'],
    clock,
    config: {
      accounts: { allowSelfRegistration: true, ...settings.accounts },
      auth: settings.auth ?? {},
    },
  });
  const tenant = runtime.tenants.acme;
  const nextAddress = clientAddresses();
  return {
    runtime,
    clock,
    client: (principal) => createLocalClient(runtime, { principal, tenant: 'acme' }),
    inUnit: (fn, options = {}) =>
      (options.sealed === true ? runtime.sealed : runtime.adapter).unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id },
        fn,
      ),
    rows: (entity, options = {}) =>
      (options.sealed === true ? runtime.sealed : runtime.adapter).unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id },
        async (unit) => {
          const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
          if (descriptor === undefined) throw new Error(`no ${entity}`);
          return (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) }))
            .rows;
        },
      ),
    request: (action, input, carrier = {}) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: {
          transport: 'test',
          headers: { 'x-tenant': tenant.id, ...carrier.headers },
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
  };
}
