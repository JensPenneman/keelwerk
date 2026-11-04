import type {
  EntityDescriptor,
  FieldDescriptor,
  IndexDescriptor,
  RelationDescriptor,
} from '@keelwerk/core';

/** An entity descriptor of the conformance app: state history, no personal data, no search. */
export function conformanceEntity(
  ref: string,
  tenancy: EntityDescriptor['tenancy'],
  fields: Record<string, FieldDescriptor>,
  relations: Record<string, RelationDescriptor> = {},
  indexes: readonly IndexDescriptor[] = [],
): EntityDescriptor {
  const [module = '', name = ''] = ref.split('.');
  return {
    ref,
    module,
    name,
    history: 'state',
    tenancy,
    shape: { id: `${ref}@1`, tracks: {} },
    dataSubject: null,
    table: `${module}__${name}`,
    fields,
    relations,
    indexes,
    partition: null,
    mergeState: false,
    searchIndexes: [],
    derivedIndexes: {},
    external: null,
  };
}
