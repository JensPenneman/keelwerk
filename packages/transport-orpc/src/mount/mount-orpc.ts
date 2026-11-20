import { errors, type HttpHandler, type MountContext, type MountHandle } from '@keelwerk/core';
import type { OrpcConfig } from '../orpc-config.ts';
import { orpcConfigOf } from '../orpc-config-of.ts';
import type { OrpcStaticOptions } from '../orpc-static-options.ts';
import { createOrpcHandler } from './create-orpc-handler.ts';
import type { OrpcHandlerDeps } from './orpc-handler-deps.ts';
import { orpcRefusal } from './orpc-refusal.ts';
import { orpcStreams } from './orpc-streams.ts';
import { orpcVersionMounts } from './orpc-version-mounts.ts';

/**
 * Mounts the oRPC transport of one app on the host (section 16.7.7): builds and checks the router of
 * every declared API version, so a surface the check refuses fails the start, and registers the RPC
 * handler under the path (default `/orpc`) and, with the `openapi` option, oRPC's OpenAPI handler
 * under its own prefix. Both routes declare the subscription paths as streams. The handlers count
 * the requests in flight: after `close` starts a new request is answered `unavailable`, and `close`
 * resolves when the requests in flight are done or the deadline aborts.
 */
export async function mountOrpc(
  ctx: MountContext<OrpcConfig>,
  options: OrpcStaticOptions,
): Promise<MountHandle> {
  const development = ctx.development === true;
  const versions = orpcVersionMounts(ctx, options);
  const deps: OrpcHandlerDeps = {
    versions,
    invoker: ctx.invoker,
    config: (scope) => orpcConfigOf(ctx.config(scope)),
    log: ctx.log,
    development,
    serializer: options.serializer ?? 'orpc',
    ...(ctx.clock === undefined ? {} : { clock: ctx.clock }),
  };
  const running = new Set<Promise<unknown>>();
  let closing = false;
  const guarded = (inner: HttpHandler, kind: 'rpc' | 'openapi'): HttpHandler => {
    return async (request, httpContext) => {
      if (closing) {
        return orpcRefusal(
          errors.unavailable('The API is shutting down.', { retryAfter: 1 }),
          {
            session: httpContext.session,
            development,
            requestId: httpContext.requestId,
            log: ctx.log,
            answer: {},
          },
          kind,
        );
      }
      const pending = inner(request, httpContext);
      running.add(pending);
      try {
        return await pending;
      } finally {
        running.delete(pending);
      }
    };
  };
  const streams = orpcStreams(versions.versions.map((version) => versions.at(version).surface));
  ctx.host.route(
    { app: ctx.app, transport: 'orpc', prefix: options.path ?? '/orpc', streams },
    guarded(createOrpcHandler(deps, 'rpc'), 'rpc'),
  );
  if (options.openapi !== undefined) {
    ctx.host.route(
      { app: ctx.app, transport: 'orpc', prefix: options.openapi, streams },
      guarded(createOrpcHandler(deps, 'openapi'), 'openapi'),
    );
  }
  return {
    close: async (deadline) => {
      closing = true;
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
