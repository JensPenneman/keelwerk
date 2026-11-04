import type { SurfaceAction } from '@keelwerk/core';

/**
 * `Deprecation` (RFC 9745), `Sunset` (RFC 8594) and a `Link` with `rel="deprecation"` for a
 * deprecated action (sections 16.4.6 and 18.5); the host adds the same for a deprecated API version.
 */
export function deprecationHeaders(
  headers: Headers,
  deprecated: SurfaceAction['deprecated'],
  reference: string,
): void {
  if (deprecated === undefined) {
    return;
  }
  const at = deprecated.at === undefined ? Number.NaN : Date.parse(deprecated.at);
  if (!Number.isNaN(at)) {
    headers.set('deprecation', `@${Math.floor(at / 1000)}`);
  }
  if (deprecated.sunset !== undefined) {
    const sunset = Date.parse(deprecated.sunset);
    if (!Number.isNaN(sunset)) {
      headers.set('sunset', new Date(sunset).toUTCString());
    }
  }
  headers.append('link', `<${reference}>; rel="deprecation"`);
}
