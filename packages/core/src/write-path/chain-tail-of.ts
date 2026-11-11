import { errors } from '../errors/errors.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The chain state (last clock, last hash) of an entity whose table keeps no `kw_*` columns (decision
 * 398: the effect record), read off the record of its stream at the row's version so the next
 * event links to it. The row of such an entity changes only through the write path, and every
 * append expects the loaded row version, so the stream's last record is the record at the row's
 * version: one bounded read of one record, whatever the stream's length. A stream with no record
 * at that version is `internal` (the row and its stream disagree), never a broken chain.
 */
export async function chainTailOf(
  unit: Unit,
  entry: EntityEntry,
  row: StorageRow,
): Promise<{ readonly kwLastHlc?: string; readonly kwLastHash?: string }> {
  const version = Number(row.version);
  const id = String(row.id);
  const [record] = await unit.events.readStream(
    { type: entry.ref, id },
    { fromVersion: version, toVersion: version, limit: 1 },
  );
  if (record === undefined) {
    throw errors.internal(`the stream ${entry.ref}/${id} has no record at version ${version}`);
  }
  return { kwLastHlc: record.hlc, ...(record.hash === null ? {} : { kwLastHash: record.hash }) };
}
