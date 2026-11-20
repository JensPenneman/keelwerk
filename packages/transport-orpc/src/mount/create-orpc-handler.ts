import { type HttpHandler, utcDayOf } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import type { OrpcAnswer } from '../router/orpc-answer.ts';
import type { OrpcContext } from '../router/orpc-context.ts';
import { actionDeprecationHeaders } from './action-deprecation-headers.ts';
import { failureHeaders } from './failure-headers.ts';
import type { OrpcHandlerDeps } from './orpc-handler-deps.ts';
import { orpcRefusal } from './orpc-refusal.ts';

/** The prefix the host stripped, as oRPC wants it: a path that starts with a slash. */
function isPath(value: string): value is `/${string}` {
  return value.startsWith('/');
}

/**
 * The response with the headers and the status the procedure asked for through `answer`, as REST
 * does it: the cookies, the command id, the replay mark, the effects, the preference, the
 * deprecation headers and the 202 of an accepted command only when the call succeeded (no
 * failure was recorded and oRPC's status is below 400); a failure carries its own headers only.
 */
function answered(
  response: Response,
  answer: OrpcAnswer,
  setCookies: readonly string[],
  today: string,
): Response {
  const headers = new Headers(response.headers);
  const succeeded = answer.failure === undefined && response.status < 400;
  if (succeeded) {
    for (const cookie of setCookies) headers.append('set-cookie', cookie);
    if (answer.commandId !== undefined) headers.set('keelwerk-command-id', answer.commandId);
    if (answer.replayed === true) headers.set('idempotent-replayed', 'true');
    if (answer.effects !== undefined) headers.set('keelwerk-effects', answer.effects.join(','));
    if (answer.accepted === true && answer.preferred === true) {
      headers.set('preference-applied', 'respond-async');
    }
    actionDeprecationHeaders(headers, answer.deprecated, today);
  } else if (answer.failure !== undefined) {
    failureHeaders(headers, answer.failure, response.status);
  }
  return new Response(response.body, {
    status: succeeded && answer.accepted === true ? 202 : response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The `HttpHandler` the host routes an oRPC mount to (section 16.7.7): it takes the mount of the
 * session's API version, then hands the request to oRPC's handler (`rpc`, or `openapi`) with the
 * context of this request. The OpenAPI handler also answers `GET /openapi.json` with the document of
 * the session's version. What the procedure reported goes onto the response: cookies, the command
 * id, the replay mark, the effects, 202 for an accepted command, `Retry-After`, `WWW-Authenticate`
 * and the deprecation headers of the action. A path oRPC does not know is `core.not_found`. It
 * never resolves a tenant or a principal.
 */
export function createOrpcHandler(deps: OrpcHandlerDeps, kind: 'rpc' | 'openapi'): HttpHandler {
  return async (request, ctx) => {
    const answer: OrpcAnswer = {};
    const base = {
      session: ctx.session,
      development: deps.development,
      requestId: ctx.requestId,
      log: deps.log,
      answer,
    };
    try {
      const mount = deps.versions.at(ctx.session.apiVersion);
      if (
        kind === 'openapi' &&
        mount.document !== undefined &&
        request.method === 'GET' &&
        ctx.path === '/openapi.json'
      ) {
        return new Response(JSON.stringify(await mount.document()), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const handler = kind === 'rpc' ? mount.rpc : mount.openapi;
      if (handler === undefined) {
        return orpcRefusal(coreError('core.not_found'), base, kind);
      }
      const now = deps.clock?.now();
      const setCookies: string[] = [];
      const context: OrpcContext = {
        session: ctx.session,
        carrier: ctx.carrier,
        requestId: ctx.requestId,
        ...(ctx.traceparent === undefined ? {} : { traceparent: ctx.traceparent }),
        signal: ctx.signal,
        invoker: deps.invoker,
        surface: mount.surface,
        wire: kind === 'openapi' ? 'json' : deps.serializer,
        development: deps.development,
        log: deps.log,
        ...(now === undefined ? {} : { now }),
        setCookies,
        answer,
      };
      const result = await handler.handle(request, {
        ...(isPath(ctx.basePath) ? { prefix: ctx.basePath } : {}),
        context,
      });
      if (!result.matched) {
        return orpcRefusal(
          coreError('core.not_found', { message: 'There is no oRPC procedure at this path.' }),
          base,
          kind,
        );
      }
      return answered(result.response, answer, setCookies, utcDayOf(now ?? Temporal.Now.instant()));
    } catch (thrown) {
      return orpcRefusal(asKeelwerkError(thrown), base, kind);
    }
  };
}
