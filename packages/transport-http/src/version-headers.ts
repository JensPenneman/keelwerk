import type { InvocationSession } from '@keelwerk/core';

/**
 * `Keelwerk-Version` on every response, and at a deprecated API version or for a deprecated action `Deprecation` (RFC 9745),
 * `Sunset` (RFC 8594) and a `Link` with `rel="deprecation"` (section 18.5).
 */
export function versionHeaders(
  headers: Headers,
  session: InvocationSession | undefined,
  requested: string | undefined,
  deprecatedAction?: { readonly at: string; readonly sunset?: string },
): void {
  const version = session?.apiVersion ?? requested;
  if (version !== undefined) {
    headers.set('keelwerk-version', version);
  }
  const deprecation = session?.deprecation ?? deprecatedAction;
  if (deprecation === null || deprecation === undefined) {
    return;
  }
  const at = Date.parse(deprecation.at);
  if (!Number.isNaN(at)) {
    headers.set('deprecation', `@${Math.floor(at / 1000)}`);
  }
  if (deprecation.sunset !== undefined) {
    const sunset = Date.parse(deprecation.sunset);
    if (!Number.isNaN(sunset)) {
      headers.set('sunset', new Date(sunset).toUTCString());
    }
  }
  headers.append('link', '</_keelwerk/v1/capabilities>; rel="deprecation"');
}
