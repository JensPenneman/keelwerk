import { clearedCookie } from '@keelwerk/core/http';
import { cors } from './cors.ts';
import type { RequestState } from './request-state.ts';
import { securityHeaders } from './security-headers.ts';
import { versionHeaders } from './version-headers.ts';

/**
 * The cross-cutting response headers of the host (section 16.3.3): request id, API version and
 * deprecation, CORS, security headers, and the cookies to set or clear. Copies the response so a
 * handler's immutable headers do not matter.
 */
export function decorateResponse(
  response: Response,
  request: Request,
  state: RequestState,
): Response {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', state.requestId);
  versionHeaders(headers, state.session, state.requestedVersion, state.deprecatedAction);
  if (state.corsOrigin !== undefined) {
    const preflight =
      request.method === 'OPTIONS' && request.headers.has('access-control-request-method');
    for (const [name, value] of cors(state.corsOrigin, preflight)) {
      if (name === 'vary') {
        headers.append(name, value);
      } else {
        headers.set(name, value);
      }
    }
  }
  const url = new URL(request.url);
  securityHeaders(
    headers,
    url.pathname,
    url.protocol === 'https:' || state.carrier?.connection?.tls !== undefined,
  );
  const setNames = new Set(
    [...state.setCookies, ...headers.getSetCookie()].map((cookie) =>
      cookie.slice(0, cookie.indexOf('=')),
    ),
  );
  for (const name of state.session?.clearCookies ?? []) {
    if (!setNames.has(name)) {
      headers.append('set-cookie', clearedCookie(name));
    }
  }
  for (const cookie of state.setCookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
