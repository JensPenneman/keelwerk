import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { ChangedOps } from './changed-ops.ts';
import { decodeEventValue } from './decode-event-value.ts';
import type { EvolvingEvent } from './evolving-event.ts';

function internal(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'internal', code: 'core.internal', message });
}

function fieldOf(entry: EntityEntry, name: string) {
  const field = entry.descriptor.fields[name];
  if (field === undefined) throw internal(`${entry.ref} has no field "${name}"`);
  return field;
}

function sum(entry: EntityEntry, name: string, current: unknown, by: number | string): unknown {
  const field = fieldOf(entry, name);
  if (field.constraints.wide === true) return (BigInt(String(current ?? 0)) + BigInt(by)) as bigint;
  return Number(current ?? 0) + Number(by);
}

function applyOps(entry: EntityEntry, row: Record<string, unknown>, ops: ChangedOps): void {
  if (ops.crdt !== undefined && Object.keys(ops.crdt).length > 0) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: 'Collaborative fields are not part of this release.',
    });
  }
  for (const [name, value] of Object.entries(ops.set ?? {})) {
    if (value === null) delete row[name];
    else row[name] = decodeEventValue(fieldOf(entry, name), value);
  }
  for (const [name, by] of Object.entries(ops.inc ?? {}))
    row[name] = sum(entry, name, row[name], by);
  for (const [name, members] of Object.entries(ops.add ?? {})) {
    const field = fieldOf(entry, name);
    const next = new Set(row[name] instanceof Set ? row[name] : []);
    for (const member of members) next.add(decodeEventValue(field.inner ?? field, member));
    row[name] = next;
  }
  for (const [name, members] of Object.entries(ops.remove ?? {})) {
    const field = fieldOf(entry, name);
    const next = new Set(row[name] instanceof Set ? row[name] : []);
    for (const member of members) next.delete(decodeEventValue(field.inner ?? field, member));
    row[name] = next;
  }
}

/**
 * The generic evolve of section 15.1.5: `created` and `imported` make the row, `changed` applies
 * its field operations in order, `archived` sets and `restored` clears `archivedAt`. It is a
 * function of the event alone, so the inline projection and a rebuild from the log agree. The
 * version, `updatedAt` and the framework columns follow the event.
 */
export function genericEvolve(
  entry: EntityEntry,
  state: StorageRow | undefined,
  event: EvolvingEvent,
): StorageRow {
  const row: Record<string, unknown> = { ...state };
  switch (event.name) {
    case 'created':
    case 'imported': {
      const { values } = event.data as { readonly values: Readonly<Record<string, unknown>> };
      for (const [name, value] of Object.entries(values)) {
        const field = entry.descriptor.fields[name];
        row[name] = field === undefined ? value : decodeEventValue(field, value);
      }
      row.id = event.id;
      row.createdAt = event.recordedAt;
      break;
    }
    case 'changed':
      if (state === undefined) throw internal(`a changed event needs the row of ${event.id}`);
      applyOps(entry, row, event.data as ChangedOps);
      break;
    case 'archived':
      if (state === undefined) throw internal(`an archived event needs the row of ${event.id}`);
      row.archivedAt = event.recordedAt;
      break;
    case 'restored':
      if (state === undefined) throw internal(`a restored event needs the row of ${event.id}`);
      delete row.archivedAt;
      break;
    default:
      throw internal(`"${event.name}" is not a generated event`);
  }
  row.version = Number(state?.version ?? 0) + 1;
  row.updatedAt = event.recordedAt;
  row.kwLastHlc = event.hlc;
  if (event.hash === null) delete row.kwLastHash;
  else row.kwLastHash = event.hash;
  return row;
}
