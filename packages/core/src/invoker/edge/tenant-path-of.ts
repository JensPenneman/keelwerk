/**
 * The tenant prefix of a request path (S-146): `/t/<segment>` at the start of the path, the
 * segment up to the next `/` or the end, taken as sent (no percent-decoding). Undefined when the
 * path does not start with `/t/`; an empty segment (`/t//x`) is answered as it is and names
 * nothing.
 */
export function tenantPathOf(
  path: string,
): { readonly prefix: string; readonly segment: string } | undefined {
  if (!path.startsWith('/t/')) return undefined;
  const end = path.indexOf('/', 3);
  const prefix = end === -1 ? path : path.slice(0, end);
  return { prefix, segment: prefix.slice(3) };
}
