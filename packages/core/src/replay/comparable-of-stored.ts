import type { StoredEvent } from '../events/stored-event.ts';
import type { ComparableEvent } from './comparable-event.ts';

/** A stored event as a comparable one: the stream, the version and the payload as stored. */
export function comparableOfStored(event: StoredEvent): ComparableEvent {
  return {
    stream: `${event.stream.type}/${event.stream.id}`,
    version: event.version,
    type: event.type,
    schemaVersion: event.schemaVersion,
    shape: event.shape,
    data: event.data,
    before: event.before,
  };
}
