import { asksForEventStream } from '@keelwerk/core/http';

const streamPaths: ReadonlySet<string> = new Set(['/_keelwerk/v1/subscribe', '/_keelwerk/v1/live']);

/**
 * Whether a request opens a long-lived stream: `/_keelwerk/v1/subscribe`, `/_keelwerk/v1/live`, any
 * `upgrade: websocket` request, or any request that asks for `text/event-stream` (a mounted route's
 * stream).
 */
export function isStreamRequest(request: Request, pathname: string): boolean {
  return (
    streamPaths.has(pathname) ||
    (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket' ||
    asksForEventStream(request)
  );
}
