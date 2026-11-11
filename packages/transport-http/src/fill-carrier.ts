import type { Carrier } from '@keelwerk/core';
import type { SocketFacts } from './socket-facts.ts';

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^bearer +(\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}

/** The ticket of `GET /_keelwerk/v1/subscribe`, with the subscription the request names; nowhere else is a `ticket` a credential. */
function ticketOf(request: Request, url: URL): Carrier['ticket'] {
  const value = url.searchParams.get('ticket');
  if (value === null || request.method !== 'GET' || url.pathname !== '/_keelwerk/v1/subscribe') {
    return undefined;
  }
  return { value, endpoint: 'subscribe', action: url.searchParams.get('action') };
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
  // A ticket is the only credential of the request it is on: the cookie and the authorization header
  // are ignored beside it, so one request never holds two (15.4.6). `ticketRefusal` has already
  // refused a ticket anywhere but a well-formed `GET /_keelwerk/v1/subscribe`.
  const ticket = ticketOf(request, url);
  if (ticket !== undefined) {
    delete headers.cookie;
    delete headers.authorization;
  }
  headers.host ??= url.host;
  const queryVersion = url.searchParams.get('keelwerk-version');
  if (request.method === 'GET' && queryVersion !== null) {
    headers['keelwerk-version'] ??= queryVersion;
  }
  const token = ticket === undefined ? bearerToken(headers.authorization) : undefined;
  return {
    transport: 'http',
    host: hostOf(url),
    path: url.pathname,
    headers,
    ...(token !== undefined && { token }),
    ...(ticket !== undefined && { ticket }),
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
