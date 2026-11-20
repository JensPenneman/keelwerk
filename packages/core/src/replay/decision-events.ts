import type { StoredEvent } from '../events/stored-event.ts';

/**
 * The events of a command that carry its decision record: `decision !== null`. Receipt change
 * records, inline effect records and settled records carry none, so a purge of the receipt records
 * or a restart of a receipt stream's versions changes nothing here (WP-96 answer 18).
 */
export function decisionEvents(events: readonly StoredEvent[]): readonly StoredEvent[] {
  return events.filter((event) => event.decision !== null);
}
