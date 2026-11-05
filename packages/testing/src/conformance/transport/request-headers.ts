import { testPrincipalHeader } from '../../harness/test-principal-header.ts';
import type { Caller } from './call.ts';
import { testCookieName } from './test-cookie-name.ts';

/** The headers a caller sends: its principal as plain data, its cookie and the browser's `Origin` and `Sec-Fetch-Site`. */
export function requestHeaders(caller: Caller): Headers {
  const headers = new Headers(caller.headers);
  if (caller.subject !== undefined && caller.subject !== null) {
    headers.set(
      testPrincipalHeader,
      JSON.stringify({ subject: caller.subject, roles: caller.roles ?? [], claims: {} }),
    );
  }
  if (caller.cookie !== undefined) {
    headers.set('cookie', `${testCookieName}=${caller.cookie}`);
  }
  if (caller.origin !== undefined) headers.set('origin', caller.origin);
  if (caller.fetchSite !== undefined) headers.set('sec-fetch-site', caller.fetchSite);
  return headers;
}
