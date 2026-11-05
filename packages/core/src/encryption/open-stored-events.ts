import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';
import { personalSealerOf } from './personal-sealer-of.ts';

/** Events as handlers and clients read them (14.7.4): personal values opened on a sealing unit, a value that stays sealed absent (14.7.9.8); the events as stored on any other. */
export function openStoredEvents(
  unit: Unit,
  events: readonly StoredEvent[],
): Promise<readonly StoredEvent[]> {
  const sealer = personalSealerOf(unit);
  return sealer === undefined ? Promise.resolve(events) : sealer.readEvents(events);
}
