import type { StreamAppend } from '@keelwerk/core';
import { conformanceId } from '@keelwerk/data/conformance';
import { newEvent } from './new-event.ts';

/** Appends to the stream `{ type, id: conformanceId(stream) }` the events with these numbers. */
export function appendOf(
  stream: number,
  events: readonly number[],
  over: Partial<StreamAppend> = {},
  type = 'conf.owner',
): StreamAppend {
  return {
    stream: { type, id: conformanceId(stream) },
    expectedVersion: 0,
    partition: null,
    events: events.map((n) => newEvent(n)),
    ...over,
  };
}
