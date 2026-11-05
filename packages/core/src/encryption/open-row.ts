import { columnKeyId } from '../keys/column-key-id.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { openStateColumn } from './open-state-column.ts';
import { personalFieldsOf } from './personal-fields-of.ts';
import type { SealingContext } from './sealing-context.ts';

/**
 * A stored row as the kernel sees it: personal values unsealed to their domain values and the
 * derived index columns removed, because handlers never see tags (14.7.9). A value whose key is
 * shredded, or that does not belong to this row and field, reads as absent.
 */
export async function openRow(
  context: SealingContext,
  entity: EntityDescriptor,
  row: StorageRow,
): Promise<StorageRow> {
  const fields = personalFieldsOf(entity);
  if (fields.length === 0) return row;
  const opened: Record<string, unknown> = { ...row };
  for (const column of Object.keys(entity.derivedIndexes)) delete opened[column];
  for (const { name, field } of fields) {
    const stored = row[name];
    if (!(stored instanceof Uint8Array)) continue;
    const keyId = columnKeyId(stored);
    const key = keyId === undefined ? undefined : await context.keyById(keyId);
    const plain = openStateColumn(stored, key?.material, field, {
      namespace: context.unit.namespace.id,
      entity: entity.ref,
      rowId: String(row.id),
      field: name,
    });
    if (plain === undefined) delete opened[name];
    else opened[name] = plain;
  }
  return opened;
}
