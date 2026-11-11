import type { Carrier, KeelwerkError } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { isAllowedOrigin } from './is-allowed-origin.ts';

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * The origin check of section 16.4.10: a request that can change state and authenticates with a
 * cookie (no bearer token; other `Authorization` schemes do not exempt) must carry an allowed `Origin`, or `Sec-Fetch-Site: same-origin`;
 * otherwise `forbidden` with `core.csrf`. Bearer-token requests are not subject to it. A `stream`
 * (a subscribe or live request, or a WebSocket upgrade) is checked although `GET` is safe: a page of
 * another site could otherwise open an `EventSource` with the user's cookie and read the stream
 * (16.4.10). A ticket is a credential of its own, never a cookie, so it is exempt like a bearer token.
 */
export function originCheck(
  method: string,
  carrier: Carrier,
  allowed: readonly string[],
  plainRequest = false,
  stream = false,
): KeelwerkError | null {
  const headers = carrier.headers ?? {};
  if (
    (safeMethods.has(method) && !stream) ||
    headers.cookie === undefined ||
    carrier.token !== undefined ||
    carrier.ticket !== undefined
  ) {
    return null;
  }
  const { origin } = headers;
  if (origin !== undefined) {
    return isAllowedOrigin(origin, headers.host, allowed, plainRequest)
      ? null
      : coreError('core.csrf');
  }
  return headers['sec-fetch-site'] === 'same-origin' ? null : coreError('core.csrf');
}
