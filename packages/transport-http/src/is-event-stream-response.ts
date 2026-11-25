/** Whether a response is a server-sent event stream: its `content-type` media type (parameters dropped, lower-cased) is `text/event-stream`. */
export function isEventStreamResponse(response: Response): boolean {
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  return type === 'text/event-stream';
}
