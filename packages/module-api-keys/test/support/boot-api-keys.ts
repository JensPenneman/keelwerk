import type { Logger, Scope } from '@keelwerk/core';
import {
  clientAddresses,
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
  type TestRuntimeOptions,
} from '@keelwerk/testing';
import { keysApp } from './keys-app.ts';

type Tenant = 'acme' | 'globex';

/** What a keyed request may add to its carrier. */
interface KeyedRequest {
  readonly tenant?: Tenant;
  readonly transport?: string;
  readonly prefer?: 'sync' | 'async';
  readonly commandId?: string;
}

/** Where the app is stored in a test. */
export type KeysStorage = 'memory' | 'pglite';

/** The time every test starts at; `advanceTo` moves it. */
export const bootedAt = Temporal.Instant.from('2026-11-20T09:00:00Z');

/** A booted app and the ways to reach it. */
export interface BootedApiKeys {
  readonly runtime: TestRuntime<typeof keysApp>;
  /** The tenant scope of acme. */
  readonly scope: Scope;
  /** A local client of a tenant (acme unless named): a signed-in person. */
  as(
    principal: TestPrincipal,
    tenant?: Tenant,
  ): ReturnType<typeof createLocalClient<typeof keysApp>>;
  /** Invokes an action presenting a key as a bearer token. */
  withKey(
    token: string,
    action: string,
    input: unknown,
    options?: KeyedRequest,
  ): ReturnType<TestRuntime<typeof keysApp>['invoker']['invoke']>;
  /** Opens a session presenting a key, as a long-lived connection does. */
  open(token: string, tenant?: Tenant): ReturnType<TestRuntime<typeof keysApp>['invoker']['open']>;
  /** The stored row of a key of acme, personal values opened. */
  row(id: string): Promise<Record<string, unknown> | undefined>;
  /** The receipt of a command of acme, or undefined. */
  receipt(
    commandId: string,
  ): Promise<{ readonly status: string; readonly outcome?: unknown } | undefined>;
}

/** Boots the app with one backend and two tenants, acme and globex, on a clock the test moves. */
export async function bootApiKeys(
  kind: KeysStorage,
  options: Pick<TestRuntimeOptions, 'logger' | 'external'> = {},
): Promise<BootedApiKeys> {
  const runtime = await startTestRuntime(keysApp, {
    adapter: kind,
    tenants: ['acme', 'globex'],
    clock: { now: () => bootedAt },
    workers: true,
    ...(options.logger === undefined ? {} : { logger: options.logger as Logger }),
    ...(options.external === undefined ? {} : { external: options.external }),
  });
  const nextAddress = clientAddresses();
  const carrierOf = (token: string, tenant: Tenant, transport: string) => ({
    transport,
    headers: { 'x-tenant': runtime.tenants[tenant].id, authorization: `Bearer ${token}` },
    connection: {
      id: 'c1',
      listener: 'http',
      remote: { address: nextAddress(), port: 40000 },
      local: { address: '127.0.0.1', port: 8080 },
    },
  });
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  return {
    runtime,
    scope,
    as: (principal, tenant = 'acme') => createLocalClient(runtime, { principal, tenant }),
    withKey: (token, action, input, request = {}) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: carrierOf(token, request.tenant ?? 'acme', request.transport ?? 'test'),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
        ...(request.prefer === undefined ? {} : { prefer: request.prefer }),
      }),
    open: (token, tenant = 'acme') => runtime.invoker.open(carrierOf(token, tenant, 'test')),
    row: (id) =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const descriptor = runtime.app.registry.entities.get('api-keys.key')?.descriptor;
        if (descriptor === undefined) throw new Error('no api-keys.key');
        return unit.rows.findOne(descriptor, {
          where: { op: 'eq', field: 'id', value: id },
          select: Object.keys(descriptor.fields),
        });
      }),
    receipt: (commandId) =>
      runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.receipts.get(commandId)),
  };
}
