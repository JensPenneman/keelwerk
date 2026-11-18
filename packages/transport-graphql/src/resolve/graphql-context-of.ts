import { deprecationsOf, type HttpContext, type SocketSession, utcDayOf } from '@keelwerk/core';
import type DataLoader from 'dataloader';
import type { DocumentNode } from 'graphql';
import type { GraphqlHandlerDeps } from '../mount/graphql-handler-deps.ts';
import type { GraphqlVersionMount } from '../mount/graphql-version-mount.ts';
import type { GraphqlContext } from './graphql-context.ts';
import { referenceLoader } from './reference-loader.ts';

/**
 * The context of one request or one subscription: its session and carrier, the surface of its API
 * version, the documents the gate checked, its own loaders and cookies; `socket` is the host's
 * session of the socket a graphql-ws subscription runs on. Never shared between requests.
 */
export function graphqlContextOf(
  deps: GraphqlHandlerDeps,
  mount: GraphqlVersionMount,
  ctx: Pick<HttpContext, 'session' | 'carrier' | 'requestId' | 'traceparent' | 'signal'>,
  documents: ReadonlyMap<string, DocumentNode>,
  socket?: SocketSession,
): GraphqlContext {
  const now = deps.clock?.now();
  const loaders = new Map<string, DataLoader<string, unknown>>();
  const context: GraphqlContext = {
    session: ctx.session,
    carrier: ctx.carrier,
    requestId: ctx.requestId,
    ...(ctx.traceparent === undefined ? {} : { traceparent: ctx.traceparent }),
    signal: ctx.signal,
    surface: mount.surface,
    invoker: deps.invoker,
    development: deps.development,
    logger: deps.log,
    ...(now === undefined ? {} : { now }),
    documents,
    loaderOf: (entity) => {
      let loader = loaders.get(entity);
      if (loader === undefined) {
        loader = referenceLoader(context, entity);
        loaders.set(entity, loader);
      }
      return loader;
    },
    clearLoaders: () => {
      for (const loader of loaders.values()) loader.clearAll();
    },
    ...(socket === undefined ? {} : { socket }),
    // The session's version notice is the first notice the context carries; an answer takes it once.
    notices: [...deprecationsOf(ctx.session, undefined, utcDayOf(now ?? Temporal.Now.instant()))],
    setCookies: [],
  };
  return context;
}
