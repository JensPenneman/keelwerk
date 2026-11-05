import type { DataAdapterFactory, Unit } from '@keelwerk/core';
import {
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
} from '@keelwerk/testing';
import { localApp } from './local-app.ts';
import { localConfig } from './portal-config.ts';

/** The tenants of a local portal. */
type TenantName = 'acme' | 'globex';

/** Where a local portal is stored. */
export type PortalStorage =
  | 'memory'
  | 'pglite'
  | { readonly factory: DataAdapterFactory; readonly url: string };

/** A portal booted in process on a clock a test moves, and the ways to reach its tenants. */
export interface LocalPortal {
  readonly runtime: TestRuntime<typeof localApp, TenantName>;
  /** A local client of a tenant (acme unless named). */
  client(
    principal: TestPrincipal,
    tenant?: 'acme' | 'globex',
  ): ReturnType<typeof createLocalClient<typeof localApp>>;
  /** Invokes an action as a request of a tenant that carries these headers (a cookie or a bearer token). */
  request(
    action: string,
    input: unknown,
    carrier?: {
      readonly headers?: Readonly<Record<string, string>>;
      readonly commandId?: string;
      readonly tenant?: 'acme' | 'globex';
    },
  ): ReturnType<TestRuntime<typeof localApp, TenantName>['invoker']['invoke']>;
  /** Runs `fn` in a unit of a tenant over the raw store. */
  inUnit<T>(fn: (unit: Unit) => Promise<T>, tenant?: 'acme' | 'globex'): Promise<T>;
}

/** Boots the portal with the backend configuration of the REST scenario and the tenants acme and globex. */
export async function startLocalPortal(storage: PortalStorage): Promise<LocalPortal> {
  const runtime = await startTestRuntime(localApp, {
    ...(typeof storage === 'string' ? { adapter: storage } : { external: storage }),
    operators: true,
    config: localConfig,
  });
  return {
    runtime,
    client: (principal, tenant = 'acme') => createLocalClient(runtime, { principal, tenant }),
    request: (action, input, carrier = {}) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: {
          transport: 'test',
          headers: { 'x-tenant': runtime.tenants[carrier.tenant ?? 'acme'].id, ...carrier.headers },
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        ...(carrier.commandId === undefined ? {} : { commandId: carrier.commandId }),
      }),
    inUnit: (fn, tenant = 'acme') =>
      runtime.adapter.unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants[tenant].id },
        fn,
      ),
  };
}
