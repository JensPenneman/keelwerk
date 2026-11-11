import { errors, type HttpContext, type HttpHandler, type KeelwerkError } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import type DataLoader from 'dataloader';
import type { DocumentNode } from 'graphql';
import { prepareDocuments } from '../request/prepare-documents.ts';
import { readGraphqlParams } from '../request/read-graphql-params.ts';
import { selectsIntrospection } from '../request/selects-introspection.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { invokeAction } from '../resolve/invoke-action.ts';
import { referenceLoader } from '../resolve/reference-loader.ts';
import { endpointHeader } from './endpoint-header.ts';
import type { GraphqlHandlerDeps } from './graphql-handler-deps.ts';
import type { GraphqlVersionMount } from './graphql-version-mount.ts';
import { refusalResponse } from './refusal-response.ts';

function contextOf(
  deps: GraphqlHandlerDeps,
  mount: GraphqlVersionMount,
  ctx: HttpContext,
  documents: ReadonlyMap<string, DocumentNode>,
): GraphqlContext {
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
    log: deps.log,
    ...(deps.clock === undefined ? {} : { now: deps.clock.now() }),
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
    setCookies: [],
  };
  return context;
}

/** The introspection authority (decision D8): `core.introspect` through the invoker decides, so the backend setting and the core rule decide once. */
async function introspectionRefusal(context: GraphqlContext): Promise<KeelwerkError | undefined> {
  const action = context.surface.actions.find((candidate) => candidate.ref === 'core.introspect');
  if (action === undefined) {
    return errors.not_found('The schema is not served.');
  }
  const outcome = await invokeAction(context, action, undefined);
  return outcome.ok ? undefined : outcome.error;
}

async function execute(
  mount: GraphqlVersionMount,
  request: Request,
  context: GraphqlContext,
  body: string,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const answer = await mount.yoga.fetch(
    new Request(new URL('/graphql', request.url), { method: 'POST', headers, body }),
    { ...context },
  );
  if (context.setCookies.length === 0) return answer;
  const merged = new Headers(answer.headers);
  for (const cookie of context.setCookies) merged.append('set-cookie', cookie);
  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers: merged,
  });
}

function graphiqlRequest(request: Request, ctx: HttpContext): Request {
  const endpoint = /^[\w\-./]*$/.test(ctx.basePath) && ctx.basePath !== '' ? ctx.basePath : '/';
  return new Request(new URL('/graphql', request.url), {
    method: 'GET',
    headers: { accept: 'text/html', [endpointHeader]: endpoint },
  });
}

/**
 * The `HttpHandler` the host routes the GraphQL mount to (section 16.6): it takes the mount of the
 * session's API version, then runs the gate, all before any resolver: the method and content type,
 * the body bound, the JSON shape, the parse with its token bound, the measure and limits of the
 * whole batch, validation without suggestions, and the introspection authority. Only then does
 * Yoga execute the documents the gate checked. It never resolves a tenant or a principal.
 */
export function createGraphqlHandler(deps: GraphqlHandlerDeps): HttpHandler {
  return async (request, ctx) => {
    const base = {
      session: ctx.session,
      development: deps.development,
      requestId: ctx.requestId,
      log: deps.log,
    };
    let mount: GraphqlVersionMount;
    try {
      mount = deps.versions.at(ctx.session.apiVersion);
    } catch (thrown) {
      return refusalResponse(asKeelwerkError(thrown), base);
    }
    if (ctx.path !== '/') {
      return refusalResponse(
        coreError('core.not_found', { message: 'There is no GraphQL endpoint at this path.' }),
        base,
      );
    }
    if (request.method === 'GET' && deps.development) {
      if ((request.headers.get('accept') ?? '').includes('text/html')) {
        return await mount.yoga.fetch(graphiqlRequest(request, ctx), {
          ...contextOf(deps, mount, ctx, new Map()),
        });
      }
    }
    if (request.method !== 'POST') {
      return refusalResponse(
        coreError('core.unsupported', { message: 'GraphQL operations are sent with POST.' }),
        base,
        405,
      );
    }
    try {
      const { batch, params } = await readGraphqlParams(
        request,
        deps.config(ctx.session.scope).maxBodyBytes,
      );
      const documents = prepareDocuments(params, mount.projection, deps.limits);
      const context = contextOf(deps, mount, ctx, documents);
      if ([...documents.values()].some(selectsIntrospection)) {
        const refusal = await introspectionRefusal(context);
        if (refusal !== undefined) return refusalResponse(refusal, base);
      }
      return await execute(mount, request, context, JSON.stringify(batch ? params : params[0]));
    } catch (thrown) {
      return refusalResponse(asKeelwerkError(thrown), base);
    }
  };
}
