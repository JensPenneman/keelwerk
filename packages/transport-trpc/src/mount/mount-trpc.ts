import type { HttpHandler, MountContext, MountHandle, Scope } from '@keelwerk/core';
import { trpcSubprotocol } from '../socket/trpc-subprotocol.ts';
import { trpcWsHandler } from '../socket/trpc-ws-handler.ts';
import type { TrpcConfig } from '../trpc-config.ts';
import { trpcConfigOf } from '../trpc-config-of.ts';
import type { TrpcStaticOptions } from '../trpc-static-options.ts';
import { createTrpcHandler } from './create-trpc-handler.ts';
import type { TrpcHandlerDeps } from './trpc-handler-deps.ts';
import { trpcStreams } from './trpc-streams.ts';
import { trpcVersionMounts } from './trpc-version-mounts.ts';

/**
 * Mounts the tRPC transport of one app on the host (section 16.7): builds and checks the router of
 * every declared API version, so a surface the check refuses fails the start, and registers one
 * handler under the path (default `/trpc`) with the stream predicate of the transport, and the
 * `keelwerk.trpc.v1` WebSocket endpoint on the same path (a backend serves it only with `websocket`; over it only
 * queries and subscriptions run: a command is refused `core.unsupported`, so a call over the socket writes no decision
 * record, which core builds only for commands and reactions). The handler
 * counts the requests in flight, and so does each query over a socket; `close` aborts every open HTTP
 * stream first, so a new request or socket call is then answered `unavailable`, and resolves when the
 * calls in flight are done or the deadline aborts.
 */
export async function mountTrpc(
  ctx: MountContext<TrpcConfig>,
  options: TrpcStaticOptions,
): Promise<MountHandle> {
  const closing = new AbortController();
  const running = new Set<Promise<unknown>>();
  const deps: TrpcHandlerDeps = {
    versions: trpcVersionMounts(ctx, options),
    invoker: ctx.invoker,
    config: (scope: Scope) => trpcConfigOf(ctx.config(scope)),
    transformer: options.transformer ?? 'superjson',
    log: ctx.log,
    development: ctx.development === true,
    ...(ctx.clock === undefined ? {} : { clock: ctx.clock }),
    closing: closing.signal,
    running,
  };
  const inner = createTrpcHandler(deps);
  const handler: HttpHandler = async (request, httpContext) => {
    const pending = inner(request, httpContext);
    running.add(pending);
    try {
      return await pending;
    } finally {
      running.delete(pending);
    }
  };
  const path = options.path ?? '/trpc';
  ctx.host.route({ app: ctx.app, transport: 'trpc', prefix: path, streams: trpcStreams }, handler);
  ctx.host.upgrade(
    { app: ctx.app, transport: 'trpc', path, protocols: [trpcSubprotocol] },
    trpcWsHandler(deps),
  );
  return {
    close: async (deadline) => {
      closing.abort();
      const settled = Promise.allSettled([...running]);
      const listener = new AbortController();
      const aborted = new Promise<void>((resolve) => {
        if (deadline.aborted) resolve();
        deadline.addEventListener('abort', () => resolve(), {
          once: true,
          signal: listener.signal,
        });
      });
      try {
        await Promise.race([settled, aborted]);
      } finally {
        listener.abort();
      }
    },
  };
}
