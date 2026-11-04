import type {
  DerivedIndexField,
  EntityDescriptor,
  FieldDescriptor,
  FieldKind,
  RelationDescriptor,
} from '@keelwerk/core';

function field(
  kind: FieldKind,
  column: string,
  over: Partial<FieldDescriptor> = {},
): FieldDescriptor {
  return {
    kind,
    column,
    optional: true,
    unique: false,
    indexed: false,
    hidden: false,
    maskable: false,
    stateOnly: false,
    sealed: false,
    merge: 'lww',
    personal: false,
    constraints: {},
    ref: null,
    inner: null,
    codec: null,
    tag: 0,
    ...over,
  };
}

function entity(
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

/** A tenant entity with a unique title. */
export const ticket = entity('app.ticket', 'app__ticket', 'tenant', {
  title: field('string', 'title', { unique: true }),
  number: field('serial', 'number'),
});

/** A backend entity. */
export const setting = entity('app.setting', 'app__setting', 'backend', {
  name: field('string', 'name'),
});

export const label = entity('app.label', 'app__label', 'tenant', { name: field('string', 'name') });

export const itemLabel = entity('app.item_label', 'app__item_label', 'tenant', {
  itemId: field('ref', 'item_id', { optional: false }),
  labelId: field('ref', 'label_id', { optional: false }),
});

/** A tenant entity related to labels through `item_label`. */
export const item = entity(
  'app.item',
  'app__item',
  'tenant',
  { name: field('string', 'name') },
  {
    labels: {
      kind: 'many',
      target: 'app.label',
      by: 'itemId',
      to: 'id',
      through: { module: 'app', entity: 'item_label', by: 'itemId', to: 'id', via: 'labelId' },
      contributedBy: null,
    },
  },
);
