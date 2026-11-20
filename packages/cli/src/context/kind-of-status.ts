import type { ErrorKind } from '@keelwerk/core';

/**
 * The error kind of an HTTP answer that carries no error envelope (a gate, a proxy, a server that is
 * starting): what the status says. A 408, 502, 503, 504 or any other 5xx is `unavailable`, so a
 * followed subscription is reopened; every other status is final, because a gate that refuses
 * (401, 403) or an address that is wrong (404) does not change by waiting.
 */
export function kindOfStatus(status: number): ErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status >= 500) return 'unavailable';
  return 'internal';
}
