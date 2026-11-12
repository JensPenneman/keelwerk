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
  router.get('/_keelwerk/health', (context) => {
    context.env.state.route = '/_keelwerk/health';
    return healthRoutes();
  });
  router.get('/_keelwerk/ready', (context) => {
    context.env.state.route = '/_keelwerk/ready';
    return readyResponse(host);
  });
  router.all('*', (context) => serveRequest(host, context.req.raw, context.env));
  router.onError((failure, context) =>
    errorResponse(host, context.env.state, asKeelwerkError(failure)),
  );
  return {
    async handle(request, extras) {
      const requestedVersion =
        request.headers.get('keelwerk-version') ??
        (request.method === 'GET'
          ? new URL(request.url).searchParams.get('keelwerk-version')
          : null);
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
        const decorated = await compressResponse(
          decorateResponse(response, request, state),
          request,
        );
        finish(state.upgraded === true ? 101 : decorated.status);
        return decorated;
      } finally {
        host.lifecycle.leave();
      }
    },
  };
}
