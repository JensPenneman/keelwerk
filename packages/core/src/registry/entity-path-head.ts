import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { PathField } from './path-field.ts';
import type { PathHead } from './path-head.ts';

/** The row's own id, which an entity path may end on. */
const idField: PathField = { kind: 'string', personal: false, sealed: false, target: null };

/** The `PathHead` of an entity: `id` and the fields of its descriptor. */
export function entityPathHead(descriptor: EntityDescriptor): PathHead {
  return {
    label: descriptor.ref,
    field: (name) => {
      if (name === 'id') return idField;
      const field = descriptor.fields[name];
      if (field === undefined) return undefined;
      return {
        kind: field.kind,
        personal: field.personal !== false,
        sealed: field.sealed,
        target: field.ref?.entity ?? null,
      };
    },
  };
}
