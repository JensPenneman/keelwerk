const streamPaths: ReadonlySet<string> = new Set(['/_keelwerk/v1/subscribe', '/_keelwerk/v1/live']);

/** Whether a request opens a long-lived stream: `/_keelwerk/v1/subscribe`, `/_keelwerk/v1/live`, or any `upgrade: websocket` request. */
export function isStreamRequest(request: Request, pathname: string): boolean {
  return (
    streamPaths.has(pathname) ||
    (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket'
  );
}
