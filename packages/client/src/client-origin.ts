/**
 * The origin requests go to: an http(s) URL without its trailing slash, or for a `unix://` URL a
 * placeholder origin, since the connection is the `fetch` function's business. Returns `undefined`
 * for any other scheme.
 */
export function clientOrigin(
  url: string,
): { readonly origin: string; readonly unix: boolean; readonly socketPath: string } | undefined {
  if (url.startsWith('unix://')) {
    return { origin: 'http://localhost', unix: true, socketPath: url.slice('unix://'.length) };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { origin: url.replace(/\/+$/, ''), unix: false, socketPath: '' };
  }
  return undefined;
}
