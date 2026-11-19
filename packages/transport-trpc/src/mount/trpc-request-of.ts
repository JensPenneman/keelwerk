import type { HttpContext } from '@keelwerk/core';

const jsonLines = 'application/jsonl';

/**
 * The `Request` tRPC gets. It is rebuilt so that tRPC reads the one `Accept` the host counted: the
 * URL is the origin, the mount-relative path and the query (joined as text, so a path that starts
 * with `//` stays a path and never becomes a host), the headers lose `content-length`,
 * `trpc-accept` and every `application/jsonl` token of `Accept`, and the header
 * `trpc-accept: application/jsonl` is set exactly when the request asks for JSON lines
 * (`jsonLines`), so a request the route did not count as a stream never streams. The body is the
 * bytes already read (none for GET and HEAD), and `signal` ends the work with the request.
 */
export function trpcRequestOf(
  request: Request,
  ctx: HttpContext,
  bytes: Uint8Array | undefined,
  asksForJsonLines: boolean,
  signal: AbortSignal,
): Request {
  const original = new URL(request.url);
  const url = new URL(`${original.origin}${ctx.path}${original.search}`);
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('trpc-accept');
  const accept = (headers.get('accept') ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '' && token !== jsonLines);
  if (accept.length === 0) headers.delete('accept');
  else headers.set('accept', accept.join(', '));
  if (asksForJsonLines) headers.set('trpc-accept', jsonLines);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && bytes !== undefined;
  return new Request(url, {
    method: request.method,
    headers,
    ...(hasBody ? { body: bytes } : {}),
    signal,
  });
}
