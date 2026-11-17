import type { HttpContext } from '@keelwerk/core';
import type { EndpointCall } from './endpoint-call.ts';

/** The `HttpContext` of a transport's WebSocket upgrade: the upgrade's session and carrier, the socket's path being `/`. */
export function upgradeHttpContext(call: EndpointCall, signal: AbortSignal): HttpContext {
  const { state } = call;
  return {
    session: call.session,
    carrier: call.carrier,
    requestId: state.requestId,
    ...(state.traceparent !== undefined && { traceparent: state.traceparent }),
    signal,
    path: '/',
    basePath: '',
  };
}
