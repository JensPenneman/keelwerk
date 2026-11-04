import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { EntityBehaviour } from './entity-behaviour.ts';

/** Evaluates the entity invariant on a post-image; a failure is `forbidden` and fails the unit (section 8.4). */
export function checkInvariant(
  entry: EntityEntry,
  behaviour: EntityBehaviour | undefined,
  row: StorageRow,
): void {
  const invariant = behaviour?.invariant;
  if (invariant === null || invariant === undefined) return;
  if (invariant(row as never)) return;
  throw new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message: `The invariant of ${entry.ref} does not hold for the new state of ${String(row.id)}.`,
    details: { invariant: entry.ref, id: row.id },
  });
}
