import { createValueKeyLifecycle } from '../keys/create-value-key-lifecycle.ts';
import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import type { Unit } from '../storage/unit.ts';
import type { EraseStreamInput } from './erase-stream.ts';
import { handledElsewhere } from './handled-elsewhere.ts';
import { sameSubject } from './same-subject.ts';
import { subjectAt } from './subject-at.ts';

/**
 * The ids of the value keys that sealing a stream's row holds, when the row is owned by the
 * subject: the keys `eraseStream` destroys. The caller reads them in a read unit BEFORE the writing
 * unit and appends their tombstones first, because once that unit commits the columns are cleared
 * and the ids can no longer be read (a tombstone for a key about to be destroyed is harmless).
 * Empty for a stream that is not a row of the subject, and for a row already erased.
 */
export async function ownedValueKeys(
  unit: Unit,
  input: Pick<EraseStreamInput, 'registry' | 'stream' | 'record'>,
): Promise<readonly string[]> {
  const { registry, stream, record } = input;
  const entry = registry.entities.get(stream.type);
  if (entry === undefined || handledElsewhere.has(entry.ref)) return [];
  if (entry.descriptor.tenancy !== 'tenant') return [];
  const { dataSubject } = entry.descriptor;
  if (dataSubject === null) return [];
  const row = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: stream.id },
    includeArchived: true,
  });
  if (row === undefined) return [];
  if (!sameSubject(await subjectAt(unit, registry, entry, row, dataSubject), record.subjectId)) {
    return [];
  }
  const lifecycle = createValueKeyLifecycle(unit);
  const keys: string[] = [];
  for (const name of sealedFieldsOf(entry)) {
    const keyId = await lifecycle.keyOf(entry, stream.id, name, false);
    if (keyId !== undefined) keys.push(keyId);
  }
  return keys;
}
