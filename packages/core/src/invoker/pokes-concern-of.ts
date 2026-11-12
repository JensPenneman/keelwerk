import type { Condition } from '../conditions/condition.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import { currentEventSchemaVersion } from '../events/current-event-schema-version.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { LiveFilterGuard } from './live-filter-guard.ts';

/** What a batch did to one row: its post-image (absent: purged, or not loaded) and its events in order. */
export interface PokesChange {
  readonly row: StorageRow | undefined;
  readonly events: readonly StoredEvent[];
}

/**
 * Whether a batch of changes to one entity concerns a principal whose plan selects `where`: some
 * changed row is in the plan's selection after the batch, or was before it (a row that left the
 * view). The before-image is the post-image with the before-images of the batch's events put back.
 * It is decided in memory and never loads a row; whatever it cannot decide (a purged row, a hidden
 * or sealed field in the condition, a value in another form than the row's, an event written with
 * another shape (the track versions of its fields, which a rename changes) or another schema
 * version than the current one: its before-image is not upcast, so a field the plan names may carry
 * its old name there) counts as concerned.
 */
export function pokesConcernOf(
  guard: LiveFilterGuard,
  descriptor: EntityDescriptor,
  where: Condition,
): (changes: readonly PokesChange[]) => boolean {
  const named = conditionFields(where).fields.map((path) => path.split('.')[0] ?? path);
  const opaque = named.some((name) => {
    const field = descriptor.fields[name];
    return field === undefined || field.hidden !== false || field.sealed;
  });
  const selects = (row: StorageRow): boolean => {
    try {
      return guard.matches(where, row);
    } catch {
      return true;
    }
  };
  /** The row as it was before the batch; undefined when it was not there, or cannot be told. */
  const before = (
    row: StorageRow,
    events: readonly StoredEvent[],
  ): StorageRow | 'unknown' | undefined => {
    if (events[0]?.version === 1) return undefined;
    if (
      events.some(
        (event) =>
          event.shape !== descriptor.shape.id || event.schemaVersion !== currentEventSchemaVersion,
      )
    ) {
      return 'unknown';
    }
    let image: Record<string, unknown> = { ...row };
    for (const event of events.toReversed()) {
      for (const [name, value] of Object.entries(event.before ?? {})) {
        if (!named.includes(name)) continue;
        if (typeof value !== typeof image[name] && value !== null && image[name] !== null) {
          return 'unknown';
        }
        if (typeof value === 'object' && value !== null) return 'unknown';
        image = { ...image, [name]: value };
      }
    }
    return image as StorageRow;
  };
  return (changes) =>
    changes.some((change) => {
      if (opaque || change.row === undefined || selects(change.row)) return true;
      const earlier = before(change.row, change.events);
      return earlier === 'unknown' || (earlier !== undefined && selects(earlier));
    });
}
