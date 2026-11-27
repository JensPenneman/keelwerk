import type { StreamRef } from '../events/stream-ref.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { handledElsewhere } from './handled-elsewhere.ts';
import { sameSubject } from './same-subject.ts';
import { subjectAt } from './subject-at.ts';

/**
 * The row of a stream, with its entity, when its data subject read now is the subject: a row that
 * an erasure finds as the subject's, whichever way it came by it. Undefined for a row that is
 * gone, of an entity that holds no data subject, of another subject or of none.
 */
export async function ownedRow(
  unit: Unit,
  registry: Registry,
  stream: StreamRef,
  subjectId: string,
): Promise<{ readonly entry: EntityEntry; readonly row: StorageRow } | undefined> {
  const entry = registry.entities.get(stream.type);
  if (entry === undefined || handledElsewhere.has(entry.ref)) return undefined;
  if (entry.descriptor.tenancy !== 'tenant') return undefined;
  const { dataSubject } = entry.descriptor;
  if (dataSubject === null) return undefined;
  const row = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: stream.id },
    includeArchived: true,
  });
  if (row === undefined) return undefined;
  return sameSubject(await subjectAt(unit, registry, entry, row, dataSubject), subjectId)
    ? { entry, row }
    : undefined;
}
