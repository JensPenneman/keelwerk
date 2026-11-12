import type { SurfaceAction } from '@keelwerk/core';
import { deprecatedFrom, deprecationHeaderOf, sunsetHeaderOf } from '@keelwerk/core';

/**
 * `Deprecation` (RFC 9745), `Sunset` (RFC 8594) and a `Link` with `rel="deprecation"` for a
 * deprecated action (sections 16.4.6 and 18.5); the host adds the same for a deprecated API version.
 * A declared `at` that is still ahead of `today` (`YYYY-MM-DD`, UTC) writes nothing: the headers
 * start on that day, as `deprecationsOf` and `invokeOne` decide. A deprecation without `at` is in
 * force from its declaration: it gets the `Link` (and `Sunset` when declared) and no `Deprecation`. `Sunset` is `sunsetHeaderOf`: the first instant no longer served.
 */
export function deprecationHeaders(
  headers: Headers,
  deprecated: SurfaceAction['deprecated'],
  reference: string,
  today: string,
): void {
  if (deprecated === undefined || !deprecatedFrom(deprecated.at, today)) {
    return;
  }
  const at = deprecated.at === undefined ? undefined : deprecationHeaderOf(deprecated.at);
  if (at !== undefined) {
    headers.set('deprecation', at);
  }
  const sunset = deprecated.sunset === undefined ? undefined : sunsetHeaderOf(deprecated.sunset);
  if (sunset !== undefined) {
    headers.set('sunset', sunset);
  }
  headers.append('link', `<${reference}>; rel="deprecation"`);
}
