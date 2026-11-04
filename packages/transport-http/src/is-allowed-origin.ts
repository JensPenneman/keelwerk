const loopbackHosts: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether an `Origin` names the request's own host or one of the tenant's allowed origins; the own-host match needs `https:` unless the
 * request itself is plain HTTP or the host is loopback. */
export function isAllowedOrigin(
  origin: string,
  host: string | undefined,
  allowed: readonly string[],
  plainRequest = false,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === 'null' || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    return false;
  }
  if (allowed.some((entry) => entry.toLowerCase() === parsed.origin)) {
    return true;
  }
  if (host === undefined || parsed.host.toLowerCase() !== host.toLowerCase()) {
    return false;
  }
  return parsed.protocol === 'https:' || plainRequest || loopbackHosts.has(parsed.hostname);
}
