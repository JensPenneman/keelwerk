import {
  defaultSelectionLimits,
  errors,
  type HttpHandler,
  type MountContext,
  type MountHandle,
  type Scope,
} from '@keelwerk/core';
import type { GraphqlConfig } from '../graphql-config.ts';
import { graphqlConfigOf } from '../graphql-config-of.ts';
import type { GraphqlStaticOptions } from '../graphql-static-options.ts';
import { graphqlWsHandler } from '../subscriptions/graphql-ws-handler.ts';
import { createGraphqlHandler } from './create-graphql-handler.ts';
import type { GraphqlHandlerDeps } from './graphql-handler-deps.ts';
import { graphqlVersionMounts } from './graphql-version-mounts.ts';
import { refusalResponse } from './refusal-response.ts';

/**
 * Mounts the GraphQL transport of one app on the host (section 16.3.2): builds and checks the
 * schema of every declared API version, so a surface the check refuses fails the start, and
 * registers one handler under the path (default `/graphql`) and, on the same path, the
 * `graphql-transport-ws` endpoint (a backend turns it on with `websocket`). The handler counts the requests in
 * flight: after `close` starts a new request is answered `unavailable`, and `close` resolves when
 * the requests in flight are done or the deadline aborts.
 */
export async function mountGraphql(
  ctx: MountContext<GraphqlConfig>,
  options: GraphqlStaticOptions,
): Promise<MountHandle> {
  const development = ctx.development === true;
  const limits = defaultSelectionLimits;
  const deps: GraphqlHandlerDeps = {
    versions: graphqlVersionMounts(ctx, options, limits),
    invoker: ctx.invoker,
    config: (scope: Scope) => graphqlConfigOf(ctx.config(scope)),
    limits,
    log: ctx.log,
    development,
    ...(ctx.clock === undefined ? {} : { clock: ctx.clock }),
  };
  const inner = createGraphqlHandler(deps);
  const running = new Set<Promise<unknown>>();
  let closing = false;
  const handler: HttpHandler = async (request, httpContext) => {
    if (closing) {
      return refusalResponse(errors.unavailable('The API is shutting down.', { retryAfter: 1 }), {
        session: httpContext.session,
        development,
        requestId: httpContext.requestId,
        log: ctx.log,
      });
    }
    const pending = inner(request, httpContext);
    running.add(pending);
    try {
      return await pending;
    } finally {
      running.delete(pending);
    }
  };
  const path = options.path ?? '/graphql';
  ctx.host.route({ app: ctx.app, transport: 'graphql', prefix: path }, handler);
  ctx.host.upgrade(
    { app: ctx.app, transport: 'graphql', path, protocols: ['graphql-transport-ws'] },
    graphqlWsHandler(deps),
  );
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
