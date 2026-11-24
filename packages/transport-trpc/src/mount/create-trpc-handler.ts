import { errors, type HttpHandler, type KeelwerkError } from '@keelwerk/core';
import {
  asKeelwerkError,
  asksForEventStream,
  coreError,
  readBoundedBody,
} from '@keelwerk/core/http';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { TrpcContext } from '../router/trpc-context.ts';
import { trpcPathOf } from '../router/trpc-path-of.ts';
import { asksForJsonLines } from './asks-for-json-lines.ts';
import { trpcCommandOptionsOf } from './trpc-command-options-of.ts';
import { trpcErrorLogger } from './trpc-error-logger.ts';
import type { TrpcHandlerDeps } from './trpc-handler-deps.ts';
import { trpcRefusal } from './trpc-refusal.ts';
import { trpcRequestOf } from './trpc-request-of.ts';
import { trpcResponseMeta } from './trpc-response-meta.ts';
import type { TrpcVersionMount } from './trpc-version-mount.ts';

/** One leading and one trailing slash taken off, as tRPC's fetch adapter does. */
function trimSlash(path: string): string {
  const head = path.startsWith('/') ? path.slice(1) : path;
  return head.endsWith('/') ? head.slice(0, -1) : head;
}

/**
 * The procedure paths a request names, read from the URL tRPC will see (the origin and the
 * mount-relative path, so dot segments and escapes of the URL are resolved as the adapter does):
 * one slash trimmed at each end, decoded as tRPC does, split on commas for a batch. A path that
 * still starts or ends with a slash after that trim is no procedure path in the adapter's reading
 * (it trims twice) and none in this one: it is undefined, and the request is refused not found, so
 * the two readings cannot differ.
 */
function pathsOf(origin: string, path: string, batch: boolean): readonly string[] | undefined {
  const trimmed = trimSlash(new URL(`${origin}${path}`).pathname);
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return undefined;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // tRPC refuses a malformed escape itself.
  }
  return batch ? decoded.split(',') : [decoded];
}

/** Whether the router has a subscription procedure at any of the paths. */
function namesSubscription(mount: TrpcVersionMount, paths: readonly string[]): boolean {
  const procedures: Readonly<Record<string, { readonly _def: { readonly type: string } }>> =
    mount.router._def.procedures;
  return paths.some(
    (path) => Object.hasOwn(procedures, path) && procedures[path]?._def.type === 'subscription',
  );
}

/**
 * Whether the answer to a call needs headers that its procedure sets while it runs: a command
 * (`Keelwerk-Command-Id`, `Keelwerk-Effects`, `Preference-Applied`) or an action with a cookie
 * hint (`Set-Cookie`). tRPC computes the headers of a JSON-lines answer before any procedure runs.
 */
function setsAnswerHeaders(mount: TrpcVersionMount, paths: readonly string[]): boolean {
  return mount.surface.actions.some(
    (action) =>
      (action.kind === 'command' || action.hints.http?.cookie !== undefined) &&
      paths.includes(trpcPathOf(action).join('.')),
  );
}

/**
 * The `HttpHandler` the host routes the tRPC mount to (section 16.7): it takes the router of the
 * session's API version and runs the gate before tRPC: after the mount closes, a request is
 * answered `unavailable`; the body is bounded; a subscription runs only alone and with
 * `Accept: text/event-stream`, else it is refused 406; a URL with `connectionParams` is refused
 * `core.validation` (they are read on the WebSocket only); an `Idempotency-Key` names one command.
 * Then `fetchRequestHandler` runs the router against a request that carries the one `Accept` the
 * host counted. A JSON-lines batch that calls a command or an action with a cookie hint is read to
 * its end and sent with the headers its procedures set (`Set-Cookie`, the command id), which
 * cannot be sent once a streamed answer has begun; the client still reads JSON lines. It never
 * resolves a tenant or a principal.
 */
export function createTrpcHandler(deps: TrpcHandlerDeps): HttpHandler {
  const headMount = (): TrpcVersionMount => deps.versions.at(deps.versions.versions.at(-1) ?? '');
  return async (request, ctx) => {
    const now = deps.clock?.now();
    const contextOf = (
      mount: TrpcVersionMount,
      command: { readonly commandId?: string; readonly prefer?: 'async' } = {},
    ): TrpcContext => ({
      session: ctx.session,
      carrier: ctx.carrier,
      requestId: ctx.requestId,
      ...(ctx.traceparent === undefined ? {} : { traceparent: ctx.traceparent }),
      surface: mount.surface,
      invoker: deps.invoker,
      transformer: deps.transformer,
      development: deps.development,
      logger: deps.log,
      ...(now === undefined ? {} : { now }),
      ...command,
      answer: { setCookies: [] },
    });
    let mount: TrpcVersionMount;
    try {
      mount = deps.versions.at(ctx.session.apiVersion);
    } catch (thrown) {
      const head = headMount();
      return trpcRefusal(head.router, asKeelwerkError(thrown), contextOf(head));
    }
    const refuse = (error: KeelwerkError, status?: number): Response =>
      trpcRefusal(mount.router, error, contextOf(mount), status);
    if (deps.closing.aborted) {
      return refuse(errors.unavailable('The API is shutting down.', { retryAfter: 1 }));
    }
    try {
      const url = new URL(request.url);
      if (url.searchParams.has('connectionParams')) {
        return refuse(
          coreError('core.validation', {
            message:
              'connectionParams are read on the WebSocket only. Over HTTP pin the API version with the Keelwerk-Version header or the keelwerk-version query parameter.',
            issues: [{ path: ['query', 'connectionParams'], message: 'Not read over HTTP.' }],
          }),
        );
      }
      const batch = url.searchParams.get('batch') === '1';
      const paths = pathsOf(url.origin, ctx.path, batch);
      if (paths === undefined) {
        return refuse(
          coreError('core.not_found', { message: 'There is no procedure at this path.' }),
        );
      }
      const bytes =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await readBoundedBody(request, deps.config(ctx.session.scope).maxBodyBytes);
      // The stream gate is the host's: a subscription runs only as the one call of a request that asks
      // for `text/event-stream`, the host's own reading of `Accept`.
      if (namesSubscription(mount, paths) && (batch || !asksForEventStream(request))) {
        return refuse(
          coreError('core.unsupported', {
            message:
              'A subscription is sent alone, with Accept: text/event-stream, and is not part of a batch.',
          }),
          406,
        );
      }
      const context = contextOf(mount, trpcCommandOptionsOf(request.headers, paths.length));
      const jsonLines = asksForJsonLines(request.headers);
      const response = await fetchRequestHandler({
        endpoint: '',
        req: trpcRequestOf(
          request,
          ctx,
          bytes,
          jsonLines,
          AbortSignal.any([ctx.signal, deps.closing]),
        ),
        router: mount.router,
        createContext: () => context,
        maxBatchSize: 20,
        allowMethodOverride: false,
        responseMeta: ({ paths: called }) => ({
          headers: trpcResponseMeta(context, called?.length ?? 0),
        }),
        onError: trpcErrorLogger(deps.log, ctx.requestId),
      });
      if (!jsonLines || !setsAnswerHeaders(mount, paths)) return response;
      // tRPC built the headers of a JSON-lines answer before any procedure ran. The answer of this
      // batch is read to its end (every procedure has run) and sent again with the headers they set.
      const body = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      for (const [name, value] of trpcResponseMeta(context, paths.length)) {
        if (name === 'set-cookie') headers.append(name, value);
        else headers.set(name, value);
      }
      return new Response(body, { status: response.status, headers });
    } catch (thrown) {
      return refuse(asKeelwerkError(thrown));
    }
  };
}
