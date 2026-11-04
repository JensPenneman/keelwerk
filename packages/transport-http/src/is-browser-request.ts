/** A browser request carries `Sec-Fetch-Site` or `Origin` (S-48). */
export function isBrowserRequest(headers: Readonly<Record<string, string>>): boolean {
  return headers['sec-fetch-site'] !== undefined || headers.origin !== undefined;
}
