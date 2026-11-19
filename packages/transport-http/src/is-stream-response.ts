const streamTypes: ReadonlySet<string> = new Set([
  'text/event-stream',
  'multipart/mixed',
  'multipart/x-mixed-replace',
  'application/jsonl',
  'application/x-ndjson',
  'application/json-seq',
]);

/**
 * Whether a response has the shape of a long-lived body: a `content-type` whose media type
 * (lower-cased, parameters dropped) is `text/event-stream`, `multipart/mixed`, `multipart/x-mixed-replace`,
 * `application/jsonl`, `application/x-ndjson` or `application/json-seq`, or a `transfer-encoding`
 * header the handler set that names `chunked`. A handler that streams a body of another type without
 * those markers is not recognised.
 */
export function isStreamResponse(response: Response): boolean {
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== undefined && streamTypes.has(type)) return true;
  return (response.headers.get('transfer-encoding') ?? '')
    .toLowerCase()
    .split(',')
    .some((coding) => coding.trim() === 'chunked');
}
