import { readEventStream, type StreamFrame } from '@keelwerk/testing';

/** The events of the stream that carry data (tRPC's own `connected` and `ping` skipped), until the stream ends or `count` came. */
export async function messages(response: Response, count: number): Promise<StreamFrame[]> {
  const reader = readEventStream(response);
  const seen: StreamFrame[] = [];
  try {
    while (seen.length < count) {
      const event = await reader.next();
      if (event === undefined) break;
      if (event.event === 'message' || event.event === 'serialized-error') seen.push(event);
      if (event.event === 'return') break;
    }
  } finally {
    await reader.close();
  }
  return seen;
}

export const sseJsonOf = (event: StreamFrame | undefined): unknown =>
  (event?.data as { json: unknown } | undefined)?.json;
