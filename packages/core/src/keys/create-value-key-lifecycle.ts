import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { parseSealedValueText } from './parse-sealed-value-text.ts';
import { sealedFieldsOf } from './sealed-fields-of.ts';

/** The value keys of one row's credential fields, by field name. */
type RowValueKeys = Map<string, string>;

/**
 * Follows the value keys of the credential fields a command touches (14.7.4): which key seals the
 * current value of each field, so that replacing a value, archiving the row or clearing the field
 * destroys the former key in the same unit. Keys a command creates are known from the start; the
 * keys of stored rows are read once per row.
 */
export interface ValueKeyLifecycle {
  /** The key now sealing `entity/id/field`, if the row has one. */
  keyOf(entry: EntityEntry, id: string, field: string, fresh: boolean): Promise<string | undefined>;
  /** Records the key a field's value is now sealed under; `undefined` when the field no longer holds one. */
  sealed(entry: EntityEntry, id: string, field: string, keyId: string | undefined): void;
  /** Destroys the key of a replaced, cleared or archived value. */
  destroy(keyId: string): Promise<void>;
}

/** The lifecycle of one command's value keys over its unit. */
export function createValueKeyLifecycle(unit: Unit): ValueKeyLifecycle {
  const known = new Map<string, RowValueKeys | undefined>();
  const slot = (entry: EntityEntry, id: string): string => `${entry.ref}/${id}`;

  const load = async (
    entry: EntityEntry,
    id: string,
    fields: readonly string[],
  ): Promise<RowValueKeys | undefined> => {
    const page = await unit.rows.find(entry.descriptor, {
      where: { op: 'eq', field: 'id', value: id },
      select: fields,
      page: { first: 1 },
      includeArchived: true,
    });
    const row = page.rows[0];
    if (row === undefined) return undefined;
    const keys: RowValueKeys = new Map();
    for (const name of fields) {
      const value = row[name] as { readonly keyId?: unknown } | string | null | undefined;
      // A secret column holds the sealed value, a verifier column its text.
      const keyId = typeof value === 'string' ? parseSealedValueText(value)?.keyId : value?.keyId;
      if (typeof keyId === 'string') keys.set(name, keyId);
    }
    return keys;
  };

  return {
    async keyOf(entry, id, field, fresh) {
      const key = slot(entry, id);
      if (!known.has(key)) {
        if (fresh) {
          known.set(key, new Map());
        } else {
          known.set(key, await load(entry, id, sealedFieldsOf(entry)));
        }
      }
      return known.get(key)?.get(field);
    },
    sealed(entry, id, field, keyId) {
      const key = slot(entry, id);
      const keys = known.get(key) ?? new Map<string, string>();
      if (keyId === undefined) keys.delete(field);
      else keys.set(field, keyId);
      known.set(key, keys);
    },
    async destroy(keyId) {
      await unit.keys.destroyValueKey(keyId);
    },
  };
}
