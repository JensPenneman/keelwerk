import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { encodeEventValue } from './encode-event-value.ts';

/**
 * The previous values of the fields an event changed (section 15.1.5, step 5). Hidden fields stay
 * out unless they opt in with `history`, as do `stateOnly`, credential and collaborative fields.
 * `null` when nothing eligible changed.
 */
export function beforeImage(
  entry: EntityEntry,
  previous: StorageRow,
  next: StorageRow,
): Readonly<Record<string, unknown>> | null {
  const before: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entry.descriptor.fields)) {
    if (field.stateOnly || field.sealed) continue;
    if (field.hidden !== false && !field.hidden.history) continue;
    if (field.kind === 'richText' || field.merge === 'sequence' || field.merge === 'richText') {
      continue;
    }
    const was = JSON.stringify(encodeEventValue(previous[name]) ?? null);
    const is = JSON.stringify(encodeEventValue(next[name]) ?? null);
    if (was !== is) before[name] = encodeEventValue(previous[name]) ?? null;
  }
  return Object.keys(before).length === 0 ? null : before;
}
