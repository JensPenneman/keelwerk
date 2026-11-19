import { asksForEventStream } from '@keelwerk/core/http';
import { asksForJsonLines } from './asks-for-json-lines.ts';

/** Whether the request asks to upgrade to a WebSocket, as the host reads the `Upgrade` header. */
function isUpgrade(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '')
    .split(',')
    .some((token) => token.trim().toLowerCase() === 'websocket');
}

/**
 * The route's `RouteSpec.streams` (section 16.3.3): a request opens a stream when it asks for
 * server-sent events (a subscription) or when tRPC would answer it as JSON lines (a streaming
 * batch). The host holds a stream slot for each until the body ends. A WebSocket upgrade is the
 * host's own socket path, never a stream of this route, so it answers false, whatever else it asks.
 */
export function trpcStreams(request: Request): boolean {
  if (isUpgrade(request)) return false;
  return asksForEventStream(request) || asksForJsonLines(request.headers);
}
