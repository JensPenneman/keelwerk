import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { Hono } from 'hono';
import { compressResponse } from './compress-response.ts';
import { decorateResponse } from './decorate-response.ts';
import type { Dispatcher } from './dispatcher.ts';
import { errorResponse } from './error-response.ts';
import { healthRoutes } from './health-routes.ts';
import type { HostBindings } from './host-bindings.ts';
import type { HostContext } from './host-context.ts';
import { readyResponse } from './ready-response.ts';
import { requestId } from './request-id.ts';
import type { RequestState } from './request-state.ts';
import type { RequestTelemetry } from './request-telemetry.ts';
import { requestedVersionOf } from './requested-version-of.ts';
import { serveRequest } from './serve-request.ts';
import { traceContext } from './trace-context.ts';
/**
 * Two-level dispatch (section 16.3.3). Hono routes the deployment's own paths
 * (`/_keelwerk/health`, `/_keelwerk/ready`); every other request goes through `serveRequest`.
 * Around both, one span, the request metrics and the response decoration.
 */
export function createDispatcher(host: HostContext, telemetry: RequestTelemetry): Dispatcher {
  // biome-ignore lint/style/useNamingConvention: `Bindings` is Hono's generic key
  const router = new Hono<{ Bindings: HostBindings }>();
  // A ticket in the query of a probe is refused and spent like on any other path under `/_keelwerk/`.
  const hasTicketMember = (request: Request): boolean =>
    new URL(request.url).searchParams.has('ticket');
  router.get('/_keelwerk/health', (context) => {
    if (hasTicketMember(context.req.raw)) return serveRequest(host, context.req.raw, context.env);
    context.env.state.route = '/_keelwerk/health';
    return healthRoutes();
  });
  router.get('/_keelwerk/ready', (context) => {
    if (hasTicketMember(context.req.raw)) return serveRequest(host, context.req.raw, context.env);
    context.env.state.route = '/_keelwerk/ready';
    return readyResponse(host);
  });
  router.all('*', (context) => serveRequest(host, context.req.raw, context.env));
  router.onError((failure, context) =>
    errorResponse(host, context.env.state, asKeelwerkError(failure)),
  );
  return {
    async handle(request, extras) {
      const { version: requestedVersion } = requestedVersionOf(request);
      const traceparent = traceContext(request.headers.get('traceparent'));
      const state: RequestState = {
        requestId: requestId(),
        ...(traceparent !== undefined && { traceparent }),
        ...(requestedVersion !== null && { requestedVersion }),
        route: 'unmatched',
        transport: 'http',
        setCookies: [],
      };
      if (!host.lifecycle.enter()) {
        const refused = errorResponse(
          host,
          state,
          coreError('core.unavailable', {
            message: 'The server is shutting down.',
            retryAfter: 1,
          }),
        );
        return decorateResponse(refused, request, state);
      }
      const finish = telemetry.begin(request, state);
      try {
        let response: Response;
        try {
          response = await router.fetch(request, { ...extras, state });
        } catch (failure) {
          response = errorResponse(host, state, asKeelwerkError(failure));
        }
        const decorated = decorateResponse(response, request, state);
        const sent = state.stream === true ? decorated : await compressResponse(decorated, request);
        finish(state.upgraded === true ? 101 : sent.status);
        return sent;
      } finally {
        host.lifecycle.leave();
      }
    },
  };
}
