import type {
  DerivedIndexField,
  EntityDescriptor,
  FieldDescriptor,
  RelationDescriptor,
} from '@keelwerk/core';

export function entityOf(
  ref: string,
  table: string,
  tenancy: EntityDescriptor['tenancy'],
  fields: Record<string, FieldDescriptor>,
  relations: Record<string, RelationDescriptor> = {},
  derivedIndexes: Record<string, DerivedIndexField> = {},
): EntityDescriptor {
  const [module = '', name = ''] = ref.split('.');
  return {
    ref,
    module,
    name,
    history: 'state',
    tenancy,
    shape: { id: 'shape', tracks: {} },
    dataSubject: null,
    table,
    fields,
    relations,
    indexes: [],
    partition: null,
    mergeState: false,
    searchIndexes: [],
    derivedIndexes,
    external: null,
  };
}
