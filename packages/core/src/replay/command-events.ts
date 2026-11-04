import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';

const pageSize = 500;

/** The events one command wrote in the unit's scope, in position order, transient records included. */
export async function commandEvents(
  unit: Unit,
  commandId: string,
): Promise<readonly StoredEvent[]> {
  const found: StoredEvent[] = [];
  let after: bigint | null = null;
  for (;;) {
    const batch = await unit.events.readAll(after, { limit: pageSize, includeTransient: true });
    for (const event of batch.events) if (event.commandId === commandId) found.push(event);
    if (batch.next === null || batch.events.length === 0) return found;
    after = batch.next;
  }
}
