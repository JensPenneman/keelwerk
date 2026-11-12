import type { InvocationSession } from '@keelwerk/core';
import { deprecationHeaderOf, sunsetHeaderOf } from '@keelwerk/core';

/** The surface of the session's API version names the deprecated actions: the `Link` of a deprecated action points there (the REST transport points at its own docs). */
const actionLink = '</_keelwerk/v1/surface>; rel="deprecation"';
const versionLink = '</_keelwerk/v1/capabilities>; rel="deprecation"';

/**
 * `Keelwerk-Version` on every response, and at a deprecated API version or for a deprecated action
 * `Deprecation` (RFC 9745, only when a date is declared: an action deprecated without `at` is in
 * force from its declaration and announces none), `Sunset` (RFC 8594, the first instant no longer
 * served: `sunsetHeaderOf`) and a `Link` with `rel="deprecation"` (section 18.5).
 */
export function versionHeaders(
  headers: Headers,
  session: InvocationSession | undefined,
  requested: string | undefined,
  deprecatedAction?: { readonly at?: string; readonly sunset?: string },
): void {
  const version = session?.apiVersion ?? requested;
  if (version !== undefined) {
    headers.set('keelwerk-version', version);
  }
  const deprecation = session?.deprecation ?? deprecatedAction;
  if (deprecation === null || deprecation === undefined) {
    return;
  }
  const at = deprecation.at === undefined ? undefined : deprecationHeaderOf(deprecation.at);
  if (at !== undefined) {
    headers.set('deprecation', at);
  }
  const sunset = deprecation.sunset === undefined ? undefined : sunsetHeaderOf(deprecation.sunset);
  if (sunset !== undefined) {
    headers.set('sunset', sunset);
  }
  headers.append(
    'link',
    session?.deprecation !== null && session?.deprecation !== undefined ? versionLink : actionLink,
  );
}
