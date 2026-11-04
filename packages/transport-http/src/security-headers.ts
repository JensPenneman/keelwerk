/** Sets the framework's response headers; a handler's own value for a header always wins. */
export function securityHeaders(headers: Headers, path: string, secure: boolean): void {
  const defaults: [string, string][] = [
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'no-referrer'],
  ];
  if (secure) {
    defaults.push(['strict-transport-security', 'max-age=31536000; includeSubDomains']);
  }
  if (path.startsWith('/_keelwerk')) {
    defaults.push(
      ['content-security-policy', "default-src 'none'; frame-ancestors 'none'"],
      ['cache-control', 'no-store'],
    );
  }
  for (const [name, value] of defaults) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
}
