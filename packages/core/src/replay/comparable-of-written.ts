import type { WrittenRow } from '../write-path/written-row.ts';
import type { ComparableEvent } from './comparable-event.ts';

/** The events a decision built, as comparable events: the stream, the version it takes and the payload. */
export function comparableOfWritten(written: readonly WrittenRow[]): readonly ComparableEvent[] {
  return written.flatMap((row) =>
    row.events.map(
      (event, index): ComparableEvent => ({
        stream: `${row.entry.ref}/${row.id}`,
        version: row.loadedVersion + index + 1,
        type: `${row.entry.ref}.${event.name}`,
        schemaVersion: event.schemaVersion,
        shape: event.shape,
        data: event.data,
        before: event.before,
      }),
    ),
  );
}
