import type { LiveLegEvent } from '../live-leg-event.ts';
import { liveLegEventOf } from './live-leg-event-of.ts';
import { parseEventStream } from './parse-event-stream.ts';

/**
 * The leg events of a `text/event-stream` body (`parseEventStream`, then `liveLegEventOf`); each
 * `notice` event's data text goes to `onNotice` and is not an event. The iterator is an object, not an
 * async generator: `return()` cancels the body at once, also with a `next()` pending.
 */
export function liveLegEventsOf(
  body: ReadableStream<Uint8Array>,
  onNotice?: (data: string) => void,
): AsyncIterable<LiveLegEvent> {
  const events = parseEventStream(body)[Symbol.asyncIterator]();
  const iterator: AsyncIterator<LiveLegEvent> = {
    async next() {
      for (;;) {
        const step = await events.next();
        if (step.done === true) return { done: true, value: undefined };
        if (step.value.event === 'notice') {
          onNotice?.(step.value.data);
          continue;
        }
        const mapped = liveLegEventOf(step.value);
        if (mapped !== undefined) return { done: false, value: mapped };
      }
    },
    async return() {
      await events.return?.(undefined);
      return { done: true, value: undefined };
    },
  };
  return { [Symbol.asyncIterator]: () => iterator };
}
