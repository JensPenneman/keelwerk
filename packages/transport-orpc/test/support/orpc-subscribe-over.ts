import {
  type EventStreamReader,
  originOf,
  readEventStream,
  requestHeaders,
  type StreamFrame,
  type SubscribeCall,
  type TransportTarget,
} from '@keelwerk/testing';
import { orpcFrameOf } from './orpc-frame-of.ts';
import { orpcPathFor } from './orpc-path-for.ts';

/**
 * One subscription over oRPC's event iterator (distinct connections): `POST <prefix>/<path>` with
 * `{ json: input }` and, when the call resumes, the `Last-Event-ID` header (`lastEventId` wins over
 * `after`). The events are read as the suite's frames (`orpcFrameOf`): `message` events as head,
 * data, reset or gap, `error` as an error frame and `done` as the end of the stream.
 */
export async function orpcSubscribeOver(
  target: TransportTarget,
  call: SubscribeCall,
  prefix: string,
): Promise<EventStreamReader> {
  const caller = call.caller ?? {};
  const headers = requestHeaders(caller);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'text/event-stream');
  const resume = call.lastEventId ?? call.after;
  if (resume !== undefined) headers.set('last-event-id', resume);
  const response = await target.fetch(
    new Request(
      `${originOf(target, caller)}${caller.pathPrefix ?? ''}${prefix}/${orpcPathFor(call.action)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: call.input ?? {} }),
      },
    ),
    call.remoteAddress === undefined ? undefined : { remoteAddress: call.remoteAddress },
  );
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return readEventStream(response);
  }
  const inner = readEventStream(response);
  let ended = false;
  const next = async (ms?: number): Promise<StreamFrame | undefined> => {
    while (!ended) {
      const event = await inner.next(ms);
      const frame = event === undefined ? 'end' : orpcFrameOf(event);
      if (frame === 'skip') continue;
      if (frame === 'end') {
        ended = true;
        return undefined;
      }
      return frame;
    }
    return undefined;
  };
  return {
    response,
    next,
    until: async (test, ms) => {
      const seen: StreamFrame[] = [];
      for (;;) {
        const frame = await next(ms);
        if (frame === undefined) return seen;
        seen.push(frame);
        if (test(frame)) return seen;
      }
    },
    close: inner.close,
  };
}
