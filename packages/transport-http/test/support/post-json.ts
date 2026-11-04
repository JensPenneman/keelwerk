/** A JSON POST request for `host.fetch`. */
export function postJson(
  path: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`https://library.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
