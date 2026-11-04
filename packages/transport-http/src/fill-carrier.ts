import type { Carrier } from '@keelwerk/core';
import type { SocketFacts } from './socket-facts.ts';

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^bearer +(\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}

/**
 * Fills the carrier of an HTTP request (section 16.4.10): host, path, lower-case headers, the
 * bearer token and the connection. `local.socket` is set on the operator socket only, so no
 * header or path can claim it.
 */
export function fillCarrier(request: Request, facts: SocketFacts): Carrier {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) {
    headers[name.toLowerCase()] = value;
  }
  headers.host ??= url.host;
  const queryVersion = url.searchParams.get('keelwerk-version');
  if (request.method === 'GET' && queryVersion !== null) {
    headers['keelwerk-version'] ??= queryVersion;
  }
  const token = bearerToken(headers.authorization);
  return {
    transport: 'http',
    host: hostOf(url),
    path: url.pathname,
    headers,
    ...(token !== undefined && { token }),
    connection: {
      id: facts.connectionId,
      listener: 'http',
      remote: facts.remote,
      local: facts.local,
      ...(facts.tls !== undefined && { tls: facts.tls }),
    },
    ...(facts.operatorSocket !== undefined && { local: { socket: facts.operatorSocket } }),
  };
}
