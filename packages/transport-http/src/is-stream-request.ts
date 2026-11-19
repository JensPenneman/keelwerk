import { asksForEventStream } from '@keelwerk/core/http';

const streamPaths: ReadonlySet<string> = new Set(['/_keelwerk/v1/subscribe', '/_keelwerk/v1/live']);

/**
 * Whether a request opens a long-lived stream: `/_keelwerk/v1/subscribe`, `/_keelwerk/v1/live`, any
 * `upgrade: websocket` request, or what the matched mount's predicate answered (`routeStreams`);
 * on a path no mount matched, a request that asks for `text/event-stream`.
 */
export function isStreamRequest(
  request: Request,
  pathname: string,
  routeStreams?: boolean,
): boolean {
  return (
    streamPaths.has(pathname) ||
    (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket' ||
    (routeStreams ?? asksForEventStream(request))
  );
}
