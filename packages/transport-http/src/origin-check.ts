import type { Carrier, KeelwerkError } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { isAllowedOrigin } from './is-allowed-origin.ts';

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/**
 * The origin check of section 16.4.10: a request that can change state and authenticates with a
 * cookie (no bearer token; other `Authorization` schemes do not exempt) must carry an allowed `Origin`, or `Sec-Fetch-Site: same-origin`;
 * otherwise `forbidden` with `core.csrf`. Bearer-token requests are not subject to it.
 */
export function originCheck(
  method: string,
  carrier: Carrier,
  allowed: readonly string[],
  plainRequest = false,
): KeelwerkError | null {
  const headers = carrier.headers ?? {};
  if (safeMethods.has(method) || headers.cookie === undefined || carrier.token !== undefined) {
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
