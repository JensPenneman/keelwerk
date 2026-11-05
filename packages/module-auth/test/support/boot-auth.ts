import { defineApp, type Logger, type Unit } from '@keelwerk/core';
import {
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
  type TestRuntimeOptions,
} from '@keelwerk/testing';
import { auth } from '../../src/module.generated.ts';

/** The auth module alone, as an app. */
const authApp = defineApp({ id: 'auth', modules: [auth] as const });

/** A clock a test moves by hand. */
export interface HandClock {
  now(): Temporal.Instant;
  advance(duration: Temporal.DurationLike): void;
}

export function handClock(): HandClock {
  let instant = Temporal.Instant.from('2026-11-05T09:00:00Z');
  return {
    now: () => instant,
    advance: (duration) => {
      instant = instant.add(duration);
    },
  };
}

/** Where the auth app is stored in a test. */
export type StorageKind = 'memory' | 'pglite';

/** A booted auth app and the ways to reach it. */
export interface BootedAuth {
  readonly runtime: TestRuntime<typeof authApp>;
  readonly clock: HandClock;
  /** A local client of a tenant (acme unless named). */
  client(
    principal: TestPrincipal,
    tenant?: 'acme' | 'globex',
  ): ReturnType<typeof createLocalClient<typeof authApp>>;
  /** Runs `fn` in a unit of the tenant over the raw store (sealed values stay sealed) or, with `sealed`, over the placement the kernel sees. */
  inUnit<T>(fn: (unit: Unit) => Promise<T>, options?: { readonly sealed?: boolean }): Promise<T>;
  /** Invokes an action as a request that carries these headers (a cookie or a bearer token) and, optionally, a remote address. */
  request(
    action: string,
    input: unknown,
    carrier?: {
      readonly headers?: Readonly<Record<string, string>>;
      readonly address?: string;
      readonly commandId?: string;
      readonly tenant?: 'acme' | 'globex';
    },
  ): ReturnType<TestRuntime<typeof authApp>['invoker']['invoke']>;
}

/** Boots the auth app alone with one backend and two tenants, acme and globex, on a clock the test moves. */
export async function bootAuth(
  kind: StorageKind,
  config: Readonly<Record<string, unknown>> = {},
  logger?: Logger,
  external?: TestRuntimeOptions['external'],
): Promise<BootedAuth> {
  const clock = handClock();
  const runtime = await startTestRuntime(authApp, {
    adapter: kind,
    operators: true,
    tenants: ['acme', 'globex'],
    clock,
    config: { auth: config },
    ...(logger === undefined ? {} : { logger }),
    ...(external === undefined ? {} : { external }),
  });
  return {
    runtime,
    clock,
    client: (principal, tenant = 'acme') => createLocalClient(runtime, { principal, tenant }),
    inUnit: (fn, options = {}) =>
      (options.sealed === true ? runtime.sealed : runtime.adapter).unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id },
        fn,
      ),
    request: (action, input, carrier = {}) => {
      const tenant = runtime.tenants[carrier.tenant ?? 'acme'];
      return runtime.invoker.invoke({
        action,
        input,
        carrier: {
          transport: 'test',
          headers: { 'x-tenant': tenant.id, ...carrier.headers },
          ...(carrier.address === undefined
            ? {}
            : {
                connection: {
                  id: 'c1',
                  listener: 'http',
                  remote: { address: carrier.address, port: 40000 },
                  local: { address: '127.0.0.1', port: 8080 },
                },
              }),
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        ...(carrier.commandId === undefined ? {} : { commandId: carrier.commandId }),
      });
    },
  };
}
