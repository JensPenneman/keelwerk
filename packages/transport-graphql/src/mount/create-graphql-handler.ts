import { errors, type HttpContext, type HttpHandler, type KeelwerkError } from '@keelwerk/core';
import { asKeelwerkError, asksForEventStream, coreError } from '@keelwerk/core/http';
import { type DocumentNode, getOperationAST } from 'graphql';
import type { GraphqlParams } from '../request/graphql-params.ts';
import { prepareDocuments } from '../request/prepare-documents.ts';
import { readGraphqlParams } from '../request/read-graphql-params.ts';
import { selectsIntrospection } from '../request/selects-introspection.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { graphqlContextOf } from '../resolve/graphql-context-of.ts';
import { invokeAction } from '../resolve/invoke-action.ts';
import { acceptForYoga } from './accept-for-yoga.ts';
import { endWithResponse } from './end-with-response.ts';
import { endpointHeader } from './endpoint-header.ts';
import type { GraphqlHandlerDeps } from './graphql-handler-deps.ts';
import type { GraphqlVersionMount } from './graphql-version-mount.ts';
import { linkedAbort } from './linked-abort.ts';
import { refusalResponse } from './refusal-response.ts';

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
  accept: string | undefined,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  if (accept !== undefined) headers.set('accept', accept);
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

/** Whether any request of the batch runs a subscription operation (the one its `operationName` names). */
function runsSubscription(
  params: readonly GraphqlParams[],
  documents: ReadonlyMap<string, DocumentNode>,
): boolean {
  return params.some(({ query, operationName }) => {
    const document = documents.get(query);
    return (
      document !== undefined &&
      getOperationAST(document, operationName)?.operation === 'subscription'
    );
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
          ...graphqlContextOf(deps, mount, ctx, new Map()),
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
    // The work of this request stops with its answer: no iterator outlives its response.
    const lifetime = linkedAbort(ctx.signal);
    try {
      const { batch, params } = await readGraphqlParams(
        request,
        deps.config(ctx.session.scope).maxBodyBytes,
      );
      const documents = prepareDocuments(params, mount.projection, deps.limits);
      // The stream gate is the host's: a subscription runs only as the one operation of a request that
      // asks for `text/event-stream` (the host's own reading of `Accept`), which is then the one
      // `Accept` Yoga negotiates with. Any other request that runs one is refused before execution.
      const subscribes = runsSubscription(params, documents);
      if (subscribes && (batch || !asksForEventStream(request))) {
        lifetime.abort();
        return refusalResponse(
          coreError('core.unsupported', {
            message:
              'A subscription is sent alone, with Accept: text/event-stream, and is not part of a batch.',
          }),
          base,
          406,
        );
      }
      const context = graphqlContextOf(deps, mount, { ...ctx, signal: lifetime.signal }, documents);
      if ([...documents.values()].some(selectsIntrospection)) {
        const refusal = await introspectionRefusal(context);
        if (refusal !== undefined) {
          lifetime.abort();
          return refusalResponse(refusal, base);
        }
      }
      const answer = await execute(
        mount,
        request,
        context,
        JSON.stringify(batch ? params : params[0]),
        acceptForYoga(request, subscribes),
      );
      return endWithResponse(answer, lifetime);
    } catch (thrown) {
      lifetime.abort();
      return refusalResponse(asKeelwerkError(thrown), base);
    }
  };
}
