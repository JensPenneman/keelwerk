import { chainColumns } from '../events/chain-columns.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import { sealedValueText } from '../keys/sealed-value-text.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { fieldWithheldFrom } from './field-withheld-from.ts';

function sealedText(value: unknown): string {
  return typeof value === 'string' ? value : sealedValueText(value as SealedValue);
}

/**
 * Turns a storage row into the row a module's part sees (section 14.8.1). The module that owns a
 * field (the entity's module, or the contributor of a contributed field) reads its hidden, secret and
 * verifier fields; every other module does not. A field another module contributes to the
 * entity is not part of the view of any module but its contributor (14.8.1); the registry only
 * gives a descriptor the fields of contributions whose `when` list is satisfied (7.6). A secret field reads as an opaque `SecretRef`
 * holding the sealed text and stamped with the owning module (a non-enumerable, internal key);
 * only a reveal by that module opens it. Members that are
 * not fields (`$masked`) pass through.
 */
export function decodeRow(entry: EntityEntry, row: StorageRow, authority: string): StorageRow {
  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    // The chain columns of a row loaded for a write are the kernel's, not the part's.
    if (chainColumns.includes(name)) continue;
    const field = entry.descriptor.fields[name];
    if (field === undefined) {
      decoded[name] = value;
      continue;
    }
    if (fieldWithheldFrom(entry, name, authority)) continue;
    const owner = entry.origin[name] ?? entry.module;
    if (field.kind === 'secret' && value !== null && value !== undefined) {
      const ref = { ref: sealedText(value) };
      Object.defineProperty(ref, secretRefOwner, { value: owner });
      decoded[name] = ref as unknown as SecretRef;
      continue;
    }
    if (field.kind === 'verifier' && value !== null && value !== undefined) {
      decoded[name] = sealedText(value);
      continue;
    }
    decoded[name] = value;
  }
  return decoded;
}
