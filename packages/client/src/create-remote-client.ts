import type { ApiSurface, EffectStatus, LiveFrame, StateToken } from '@keelwerk/core';
import type { AppClient } from './app-client.ts';
import { clientOrigin } from './client-origin.ts';
import { createRetryPolicy } from './create-retry-policy.ts';
import { createSurfaceCache } from './create-surface-cache.ts';
import type { DeclaredErrorOf } from './declared-error-of.ts';
import type { EffectReferences } from './effect-references.ts';
import type { EventOf } from './event-of.ts';
import type { InputOf } from './input-of.ts';
import type { InvokableRef } from './invokable-ref.ts';
import type { InvokeOptions } from './invoke-options.ts';
import { loadSurface } from './load-surface.ts';
import type { Prefer } from './prefer.ts';
import type { RemoteClientOptions } from './remote-client-options.ts';
import type { RemoteClientState } from './remote-client-state.ts';
import type { RemoteConnection } from './remote-connection.ts';
import type { ResultOf } from './result-of.ts';
import { runInvocation } from './run-invocation.ts';
import { subscribeRemote } from './subscribe-remote.ts';
import type { SubscriptionRef } from './subscription-ref.ts';
import type { TaxonomyError } from './taxonomy-error.ts';
import { waitForEffects } from './wait-for-effects.ts';

function stateOf(connection: RemoteConnection): RemoteClientState {
  return {
    ...connection,
    surfaces: createSurfaceCache(() => loadSurface(connection), connection.committed),
  };
}

function clientOver<App>(state: RemoteClientState): AppClient<App> {
  return {
    async invoke<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
      ref: R,
      input: InputOf<App, R>,
      options: InvokeOptions<P> = {},
    ): Promise<ResultOf<App, R, P>> {
      const result = await runInvocation(state, ref, input, options);
      if (!result.ok) throw result.error;
      return result.value as ResultOf<App, R, P>;
    },
    async attempt<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
      ref: R,
      input: InputOf<App, R>,
      options: InvokeOptions<P> = {},
    ): Promise<
      | {
          readonly ok: true;
          readonly value: ResultOf<App, R, P>;
          readonly commandId?: string;
          readonly effects?: EffectReferences;
        }
      | {
          readonly ok: false;
          readonly error: DeclaredErrorOf<App, R> | TaxonomyError;
          readonly commandId?: string;
          readonly effects?: EffectReferences;
        }
    > {
      const result = await runInvocation(state, ref, input, options);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error as unknown as DeclaredErrorOf<App, R> | TaxonomyError,
          ...(result.commandId !== undefined && { commandId: result.commandId }),
          ...(result.effects !== undefined && { effects: result.effects }),
        };
      }
      return {
        ok: true,
        value: result.value as ResultOf<App, R, P>,
        ...(result.commandId !== undefined && { commandId: result.commandId }),
        ...(result.effects !== undefined && { effects: result.effects }),
      };
    },
    subscribe<R extends SubscriptionRef<App>>(
      ref: R,
      input: InputOf<App, R>,
      options: { readonly after?: StateToken; readonly signal?: AbortSignal } = {},
    ): AsyncIterable<LiveFrame<EventOf<App, R>>> {
      return subscribeRemote(state, ref, input, options) as AsyncIterable<
        LiveFrame<EventOf<App, R>>
      >;
    },
    waitForEffects(effectIds, options = {}): Promise<readonly EffectStatus[]> {
      return waitForEffects(state, effectIds, options);
    },
    as(selector): AppClient<App> {
      return clientOver<App>({
        ...state,
        ...(selector.backend !== undefined && { backend: selector.backend }),
        ...(selector.tenant !== undefined && { tenant: selector.tenant }),
        ...(selector.token !== undefined && { token: selector.token }),
      });
    },
    async surface(): Promise<ApiSurface> {
      return (await state.surfaces.get()).surface;
    },
  };
}

/**
 * The typed client over the invocation protocol (section 16.8.4): values are encoded and decoded
 * with the surface, so `Temporal` values and `bigint` arrive in their in-process form, and network
 * failures are retried at most three times with jittered backoff under the same command id.
 */
export function createRemoteClient<App>(options: RemoteClientOptions): AppClient<App> {
  const target = clientOrigin(options.url);
  if (target === undefined) {
    throw new TypeError(
      `The client url must start with http://, https:// or unix:// (got ${options.url}).`,
    );
  }
  if (target.unix && options.fetch === undefined) {
    throw new TypeError(
      'A unix:// url needs the fetch of @keelwerk/client/unix-socket: unixSocketFetch(socketPath).',
    );
  }
  if (target.unix && options.live === 'websocket') {
    throw new TypeError('The websocket carrier cannot reach a unix:// url: use live: "sse".');
  }
  const fetchSocket: unknown =
    target.unix && options.fetch !== undefined
      ? Reflect.get(options.fetch, 'socketPath')
      : undefined;
  if (typeof fetchSocket === 'string' && fetchSocket !== target.socketPath) {
    throw new TypeError(
      `The url names the socket ${target.socketPath}, but the fetch talks to ${fetchSocket}.`,
    );
  }
  return clientOver<App>(
    stateOf({
      origin: target.origin,
      apiVersion: options.apiVersion,
      send: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      retry: createRetryPolicy(options.retry),
      ...(options.live !== undefined && { live: options.live }),
      ...(options.webSocket !== undefined && { webSocket: options.webSocket }),
      ...(options.token !== undefined && { token: options.token }),
      ...(options.backend !== undefined && { backend: options.backend }),
      ...(options.tenant !== undefined && { tenant: options.tenant }),
      ...(options.deviceId !== undefined && { deviceId: options.deviceId }),
      ...(options.surface !== undefined && { committed: options.surface }),
    }),
  );
}
