/**
 * Whether tRPC answers a request as JSON lines: its own rule, as `resolveResponse` reads it. A
 * `trpc-accept` header decides alone (it must equal `application/jsonl`); without one, an `Accept`
 * token equal to `application/jsonl` does.
 */
export function asksForJsonLines(headers: Headers): boolean {
  const trpcAccept = headers.get('trpc-accept');
  if (trpcAccept !== null) return trpcAccept === 'application/jsonl';
  return (headers.get('accept') ?? '')
    .split(',')
    .some((token) => token.trim() === 'application/jsonl');
}
