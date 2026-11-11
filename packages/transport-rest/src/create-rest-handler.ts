import {
  type ApiSurface,
  errors,
  type HttpContext,
  type HttpHandler,
  type KeelwerkError,
  newUuidV7,
} from '@keelwerk/core';
import { asKeelwerkError, coreError, decodeActionInput } from '@keelwerk/core/http';
import { audienceOf } from './audience-of.ts';
import { decodeRequest } from './decode-request.ts';
import { encodeResponse } from './encode-response.ts';
import { idempotencyKey } from './idempotency-key.ts';
import { locateRoute } from './locate-route.ts';
import type { OpenApiDocuments } from './openapi-documents.ts';
import { readPreconditions } from './preconditions.ts';
import { preferHeader } from './prefer-header.ts';
import { problemResponse } from './problem-details.ts';
import { referencePage } from './reference-page.ts';
import type { RestHandlerDeps } from './rest-handler-deps.ts';
import type { RestVersionMount } from './rest-version-mount.ts';
import type { RouteMatch } from './route-table.ts';
import { signalOf } from './signal-of.ts';

async function serveRoute(
  deps: RestHandlerDeps,
  surface: ApiSurface,
  request: Request,
  ctx: HttpContext,
  match: RouteMatch,
  mountPath: string,
  method: string,
): Promise<Response> {
  const { route, params } = match;
  const { action } = route;
  if (route.mode === 'stream') {
    throw coreError('core.live_unavailable');
  }
  const config = deps.config(ctx.session.scope);
  const preconditions = readPreconditions(request.headers);
  const input = await decodeRequest(request, {
    route,
    params,
    preconditions,
    maxBodyBytes: config.maxBodyBytes,
  });
  const isCommand = action.kind === 'command';
  const commandId = isCommand ? (idempotencyKey(request.headers) ?? newUuidV7()) : undefined;
  const preferredAsync =
    isCommand &&
    action.execution === 'either' &&
    preferHeader(request.headers.get('prefer')).respondAsync;
  const outcome = await deps.invoker.invoke({
    action: action.ref,
    input: decodeActionInput(surface, action, input),
    carrier: { ...ctx.carrier, transport: 'rest' },
    session: ctx.session,
    requestId: ctx.requestId,
    ...(commandId !== undefined && { commandId }),
    ...(preferredAsync && { prefer: 'async' as const }),
    ...(ctx.traceparent !== undefined && { traceparent: ctx.traceparent }),
    signal: signalOf(action, ctx.signal),
  });
  if (!outcome.ok) {
    throw outcome.error;
  }
  const response = encodeResponse(outcome, {
    route,
    request,
    session: ctx.session,
    requestId: ctx.requestId,
    deploymentId: deps.deploymentId,
    mountPath,
    ...(commandId !== undefined && { commandId }),
    preferredAsync,
    ifNoneMatch: preconditions.ifNoneMatch,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
  return method === 'HEAD'
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}

interface Pages {
  readonly problem: (code: string) => Response | undefined;
  readonly reference: (request: Request) => Promise<Response>;
}

async function serveMeta(
  deps: RestHandlerDeps,
  pages: Pages,
  documents: OpenApiDocuments,
  request: Request,
  ctx: HttpContext,
  name: 'docs' | 'openapi' | 'problem',
  code: string,
  mountPath: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (name === 'problem') {
    const page = pages.problem(code);
    if (page === undefined) {
      throw errors.not_found(`There is no problem '${code}'.`);
    }
    return page;
  }
  if (name === 'openapi') {
    const document = documents(
      `generated/openapi/${deps.app}/${ctx.session.apiVersion}.json`,
      `${url.origin}${mountPath}`,
    );
    if (document === undefined) {
      throw errors.not_found('This API has no OpenAPI document.');
    }
    return new Response(document, { headers: { 'content-type': 'application/json' } });
  }
  if (!deps.development && !deps.config(ctx.session.scope).docs) {
    throw errors.not_found('The API reference is not enabled.');
  }
  return await pages.reference(request);
}

function failure(
  deps: RestHandlerDeps,
  error: KeelwerkError,
  request: Request,
  ctx: HttpContext,
  mountPath: string,
): Response {
  if (error.kind === 'internal') {
    deps.log.error('The REST request failed.', {
      requestId: ctx.requestId,
      code: error.code,
      cause: error.cause,
    });
  }
  return problemResponse(error, {
    request,
    mountPath,
    requestId: ctx.requestId,
    audience: audienceOf(ctx.session, deps.development),
    apiVersion: ctx.session.apiVersion,
  });
}

/**
 * The `HttpHandler` the host routes the mount's prefix to (section 16.3.3): finds the route of the
 * request, decodes it, invokes the action with the host's session and answers with the response of
 * 16.5.3 or an RFC 9457 problem. It never resolves a tenant or a principal, and never evaluates a
 * policy or a mask (section 16.3.1).
 */
export function createRestHandler(deps: RestHandlerDeps): HttpHandler {
  const basePath = deps.options.basePath ?? '/api';
  const reference = referencePage();
  return async (request, ctx) => {
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    let mount: RestVersionMount;
    try {
      mount = deps.versions.at(ctx.session.apiVersion);
    } catch (thrown) {
      const mountPath = deps.root === true ? basePath : ctx.basePath;
      return failure(deps, asKeelwerkError(thrown), request, ctx, mountPath);
    }
    const pages: Pages = { problem: mount.problem, reference };
    const { documents } = mount;
    const located = locateRoute(mount.table, method, {
      path: ctx.path,
      stripped: ctx.basePath,
      basePath,
      root: deps.root === true,
    });
    try {
      switch (located.kind) {
        case 'none':
          throw errors.not_found('There is no route for this path.');
        case 'meta':
          return await serveMeta(
            deps,
            pages,
            documents,
            request,
            ctx,
            located.name,
            located.code,
            located.mountPath,
          );
        case 'route':
          return await serveRoute(
            deps,
            mount.surface,
            request,
            ctx,
            located.match,
            located.mountPath,
            request.method,
          );
      }
    } catch (thrown) {
      return failure(deps, asKeelwerkError(thrown), request, ctx, located.mountPath);
    }
  };
}
