import { type ApiSurface, isAppNotServedError } from '@keelwerk/core';
import type { EndpointCall } from './endpoint-call.ts';

/**
 * The surface of the session's app and version, or `undefined` when the process does not serve the
 * app (the invoker then answers for it). Any other failure of the surface, a version the projection
 * cannot derive for one, is not an unknown action: it propagates, so the endpoint answers an
 * internal error and logs it, and no answer leaves without its wire encoding.
 */
export function servedSurfaceOf(call: EndpointCall): ApiSurface | undefined {
  const { session, host } = call;
  try {
    return host.deps.surface(session.app, session.apiVersion);
  } catch (failure) {
    if (isAppNotServedError(failure)) return undefined;
    throw failure;
  }
}
