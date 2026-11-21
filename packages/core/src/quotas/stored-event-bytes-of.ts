import type { StoredEvent } from '../events/stored-event.ts';
import { storedEventBytes } from './stored-event-bytes.ts';

/**
 * `storedEventBytes` of an event read back from the store: the meta is rebuilt from the members of
 * the envelope, so a removal measures what the append charged.
 */
export function storedEventBytesOf(event: StoredEvent): bigint {
  return storedEventBytes({
    data: event.data,
    before: event.before,
    meta: {
      actor: event.actor,
      commandId: event.commandId,
      action: event.action,
      causationId: event.causationId,
      correlationId: event.correlationId,
      client: event.client,
      merge: event.merge,
      traceparent: event.traceparent,
      writer: event.writer,
      flags: event.flags,
      decision: event.decision,
      ...(event.lineage === undefined ? {} : { lineage: event.lineage }),
    },
  });
}
