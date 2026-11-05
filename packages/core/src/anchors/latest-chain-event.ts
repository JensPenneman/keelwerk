import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The newest event of the unit's scope that carries a hash. The head usually is that event; when
 * transient records sit at the head (an entity without a chain), the read steps back in doubling
 * windows until it meets a chained one. `null` for a scope with no chained event.
 */
export async function latestChainEvent(unit: Unit): Promise<StoredEvent | null> {
  const head = await unit.events.head();
  if (head === null) return null;
  let back = 1n;
  for (;;) {
    const after = head - back > 0n ? head - back : null;
    const page = await unit.events.readAll(after, { limit: Number(back) });
    const chained = page.events.findLast((event) => event.hash !== null);
    if (chained !== undefined) return chained;
    if (after === null) return null;
    back *= 2n;
  }
}
