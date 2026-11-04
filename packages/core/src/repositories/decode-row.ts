import type { SecretRef } from '../ids/secret-ref.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/**
 * Turns a storage row into the row a module's part sees (section 14.8.1). The module that owns a
 * field (the entity's module, or the contributor of a contributed field) reads its hidden and
 * verifier fields; every other module does not. A field another module contributes to the
 * entity is not part of the view of any module but its contributor (14.8.1); the registry only
 * gives a descriptor the fields of contributions whose `when` list is satisfied (7.6). Secret fields read as an opaque `SecretRef`
 * naming the row and the field, whoever holds the row; only a reveal opens it. Members that are
 * not fields (`$masked`) pass through.
 */
export function decodeRow(entry: EntityEntry, row: StorageRow, authority: string): StorageRow {
  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    const field = entry.descriptor.fields[name];
    if (field === undefined) {
      decoded[name] = value;
      continue;
    }
    const contributor = entry.origin[name];
    if (contributor !== undefined && contributor !== authority) continue;
    const owner = contributor ?? entry.module;
    if ((field.hidden !== false || field.kind === 'verifier') && owner !== authority) continue;
    if (field.kind === 'secret' && value !== null && value !== undefined) {
      decoded[name] = { ref: `${entry.ref}/${String(row.id)}/${name}` } as unknown as SecretRef;
      continue;
    }
    decoded[name] = value;
  }
  return decoded;
}
