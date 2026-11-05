/** A browser request carries `Sec-Fetch-Site` or `Origin` (S-48); the headers are a `Headers` or a lower-case record. */
export function isBrowserRequest(headers: Headers | Readonly<Record<string, string>>): boolean {
  return headers instanceof Headers
    ? headers.has('sec-fetch-site') || headers.has('origin')
    : headers['sec-fetch-site'] !== undefined || headers.origin !== undefined;
}
