import { asKeelwerkError } from './as-keelwerk-error.ts';
import type { EndpointCall } from './endpoint-call.ts';
import { errorResponse } from './error-response.ts';
import { jsonResponse } from './json-response.ts';

function matches(ifNoneMatch: string | undefined, hash: string): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((entry) => entry.trim().replace(/^W\//, ''))
    .some((entry) => entry === '*' || entry === `"${hash}"`);
}

/** `GET /_keelwerk/v1/surface`: the surface at the session's API version; `ETag` is its hash (section 16.8.2). */
export function surfaceEndpoint(call: EndpointCall): Response {
  const { host, state, session, carrier } = call;
  try {
    const surface = host.deps.surface(session.app, session.apiVersion);
    const headers = new Headers({
      etag: `"${surface.hash}"`,
      'cache-control': 'private, no-cache',
    });
    if (matches(carrier.headers?.['if-none-match'], surface.hash)) {
      return new Response(null, { status: 304, headers });
    }
    return jsonResponse(200, surface, headers);
  } catch (failure) {
    return errorResponse(host, state, asKeelwerkError(failure));
  }
}
