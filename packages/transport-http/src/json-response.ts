/** A JSON body with the given status; the host's decoration adds the rest. */
export function jsonResponse(
  status: number,
  body: unknown,
  headers?: ConstructorParameters<typeof Headers>[0],
): Response {
  const out = new Headers(headers);
  out.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: out });
}
