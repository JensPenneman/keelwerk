import type { KeyService } from '../kernel/key-service.ts';
import { deriveFieldKey } from '../keys/derive-field-key.ts';
import type { DerivedIndexField } from '../storage/derived-index-field.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import { indexRootKey } from './index-root-key.ts';
import type { PersonalDeclaration } from './personal-declaration.ts';

/** The index keys of one scope, derived on first use and kept for the life of the value. */
export interface IndexKeys {
  /** The key of one capability of one field (14.7.9.7). */
  fieldKey(
    entity: EntityDescriptor,
    field: string,
    personal: PersonalDeclaration,
    derived: DerivedIndexField,
  ): Promise<Uint8Array>;
}

/** Index keys over the key service for a scope: the root of the derived field's key version, then HKDF per capability. */
export function createIndexKeys(keys: Pick<KeyService, 'derive'>, scope: StorageScope): IndexKeys {
  const roots = new Map<number, Promise<Uint8Array>>();
  const fields = new Map<string, Promise<Uint8Array>>();
  return {
    fieldKey: (entity, field, personal, derived) => {
      const slot = `${entity.ref}\u0000${field}\u0000${derived.query}\u0000${derived.keyVersion}`;
      const known = fields.get(slot);
      if (known !== undefined) return known;
      let root = roots.get(derived.keyVersion);
      if (root === undefined) {
        root = indexRootKey(keys, scope, derived.keyVersion);
        roots.set(derived.keyVersion, root);
      }
      const made = root.then((material) =>
        deriveFieldKey(material, {
          entity: entity.ref,
          field,
          capability: derived.query,
          normaliser: `${personal.normalize.id}@${personal.normalize.version}`,
          parameters: derived.query === 'eq' ? { bits: personal.params.eq.bits } : undefined,
        }),
      );
      fields.set(slot, made);
      return made;
    },
  };
}
