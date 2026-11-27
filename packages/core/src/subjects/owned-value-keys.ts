import { createValueKeyLifecycle } from '../keys/create-value-key-lifecycle.ts';
import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import type { Unit } from '../storage/unit.ts';
import type { EraseStreamInput } from './erase-stream.ts';
import { ownedRow } from './owned-row.ts';

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
  const owned = await ownedRow(unit, registry, stream, record.subjectId);
  if (owned === undefined) return [];
  const lifecycle = createValueKeyLifecycle(unit);
  const keys: string[] = [];
  for (const name of sealedFieldsOf(owned.entry)) {
    const keyId = await lifecycle.keyOf(owned.entry, stream.id, name, false);
    if (keyId !== undefined) keys.push(keyId);
  }
  return keys;
}
