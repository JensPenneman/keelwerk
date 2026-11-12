import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';
import { personalSealerOf } from './personal-sealer-of.ts';

/** Events as handlers and clients read them (14.7.4): personal values opened on a sealing unit, a value that stays sealed absent (14.7.9.8), or `{ redacted: true }` for `history`; the events as stored on any other. */
export function openStoredEvents(
  unit: Unit,
  events: readonly StoredEvent[],
  mode: 'read' | 'history' = 'read',
): Promise<readonly StoredEvent[]> {
  const sealer = personalSealerOf(unit);
  if (sealer === undefined) return Promise.resolve(events);
  return mode === 'history' ? sealer.historyEvents(events) : sealer.readEvents(events);
}
