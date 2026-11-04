import type { EntityEntry } from '../registry/entity-entry.ts';

/**
 * Whether a write to the entity appends transient change records instead of chain events
 * (section 15.1.10): `history: 'state'` entities update the row and record the change without a hash.
 */
export function transientRecords(entry: EntityEntry): boolean {
  return entry.descriptor.history === 'state';
}
