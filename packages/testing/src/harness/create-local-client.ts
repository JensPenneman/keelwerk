import type {
  AppClient,
  InputOf,
  InvokableRef,
  InvokeOptions,
  Prefer,
  ResultOf,
} from '@keelwerk/client';
import type { ApiSurface, KeelwerkError } from '@keelwerk/core';
import { deriveSurface, errors } from '@keelwerk/core';
import type { ClientRuntime } from './client-runtime.ts';
import { liveUnavailable } from './live-unavailable.ts';
import type { LocalClientOptions } from './local-client-options.ts';
import type { TestApp } from './test-app.ts';
import { testCarrier } from './test-carrier.ts';
import type { TestPrincipal } from './test-principal.ts';
import type { TestTenant } from './test-tenant.ts';

interface Bound {
  readonly runtime: ClientRuntime<TestApp>;
  readonly tenant: TestTenant;
  readonly principal: TestPrincipal;
}

type Answer =
  | { readonly ok: true; readonly value: unknown; readonly commandId?: string }
  | { readonly ok: false; readonly error: KeelwerkError };

async function run(
  bound: Bound,
  ref: string,
  input: unknown,
  options: InvokeOptions<Prefer>,
): Promise<Answer> {
  const { runtime } = bound;
  if (options.waitEffects !== undefined && options.waitEffects !== false) {
    return { ok: false, error: liveUnavailable('Waiting for effects') };
  }
  const isCommand = runtime.app.registry.actions.get(ref)?.kind === 'command';
  const commandId = isCommand ? (options.commandId ?? crypto.randomUUID()) : undefined;
  const outcome = await runtime.invoker.invoke({
    action: ref,
    input,
    carrier: testCarrier(bound.tenant, bound.principal),
    requestId: crypto.randomUUID(),
    signal: options.signal ?? new AbortController().signal,
    ...(commandId === undefined ? {} : { commandId }),
    ...(options.prefer === undefined ? {} : { prefer: options.prefer }),
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return {
    ok: true,
    value: outcome.receipt ?? outcome.value,
    ...(commandId === undefined ? {} : { commandId }),
  };
}

function clientOver<App>(bound: Bound): AppClient<App> {
  return {
    async invoke<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
      ref: R,
      input: InputOf<App, R>,
      options: InvokeOptions<P> = {},
    ): Promise<ResultOf<App, R, P>> {
      const answer = await run(bound, ref, input, options);
      if (!answer.ok) throw answer.error;
      return answer.value as ResultOf<App, R, P>;
    },
    async attempt(ref, input, options = {}) {
      const answer = await run(bound, ref, input, options);
      if (!answer.ok) return { ok: false, error: answer.error as never };
      return {
        ok: true,
        value: answer.value as never,
        ...(answer.commandId === undefined ? {} : { commandId: answer.commandId }),
      };
    },
    subscribe() {
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(liveUnavailable('Subscribing')),
        }),
      };
    },
    waitForEffects(): Promise<never> {
      return Promise.reject(liveUnavailable('Waiting for effects'));
    },
    as(selector): AppClient<App> {
      if (selector.token !== undefined || selector.backend !== undefined) {
        throw errors.unsupported(
          'A local client is bound to one backend and a principal; choose another with createLocalClient.',
        );
      }
      const found = Object.values<TestTenant>(bound.runtime.tenants).find(
        (tenant) => tenant.name === selector.tenant || tenant.id === selector.tenant,
      );
      if (selector.tenant !== undefined && found === undefined) {
        throw errors.not_found(`The test runtime has no tenant ${selector.tenant}.`);
      }
      return clientOver<App>({ ...bound, tenant: found ?? bound.tenant });
    },
    async surface(): Promise<ApiSurface> {
      return deriveSurface(bound.runtime.app, bound.runtime.head).surface;
    },
  };
}

/**
 * The same interface as the remote client over the in-process invoker with a test carrier, so a
 * test exercises the whole pipeline without a socket (section 16.8.5). A failure rejects with the
 * `KeelwerkError` the pipeline produced.
 */
export function createLocalClient<App extends TestApp, Name extends string = string>(
  runtime: ClientRuntime<App, Name>,
  options: LocalClientOptions<Name>,
): AppClient<App> {
  const tenants = Object.values<TestTenant>(runtime.tenants);
  const tenant =
    options.tenant === undefined
      ? tenants[0]
      : tenants.find((entry) => entry.name === options.tenant);
  if (tenant === undefined) {
    throw errors.not_found(`The test runtime has no tenant ${options.tenant ?? '(any)'}.`);
  }
  return clientOver<App>({ runtime, tenant, principal: options.principal });
}
