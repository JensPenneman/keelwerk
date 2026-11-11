import type { FieldNode } from '../src/surface/field-node.ts';
import type { SurfaceEntity } from '../src/surface/surface-entity.ts';
import { surfaceOf } from './surface-kit.ts';

const base = { optional: false, access: 'read-write' } as const;

const refTo = (target: string, prefix: string, optional = false): FieldNode => ({
  ...base,
  optional,
  kind: 'ref',
  target,
  prefix,
});

const entityOf = (
  ref: string,
  prefix: string,
  fields: Record<string, FieldNode>,
  relations: SurfaceEntity['relations'] = {},
): SurfaceEntity => ({
  ref,
  module: 'shop',
  name: ref.split('.').at(-1) ?? ref,
  prefix,
  history: 'chain',
  tenancy: 'tenant',
  fields: { id: { ...base, access: 'read', kind: 'id', target: ref, prefix }, ...fields },
  relations,
  generated: ['query', 'queryChanges', 'watch', 'create'],
  page: { sortable: [], defaultSort: [], defaultSize: 25, maxSize: 100 },
  origin: {},
});

/** `shop.item` (prefix itm): a parent reference, a list and a set of tag references, a label, and the relations notes and owner. */
export const shopItem: SurfaceEntity = entityOf(
  'shop.item',
  'itm',
  {
    parent: refTo('shop.item', 'itm', true),
    tags: { ...base, kind: 'list', item: refTo('shop.tag', 'tag') },
    related: { ...base, kind: 'set', item: refTo('shop.tag', 'tag') },
    label: { ...base, kind: 'string' },
  },
  {
    notes: { kind: 'many', target: 'shop.note', by: 'item' },
    owner: { kind: 'one', target: 'shop.item', by: 'parent' },
  },
);
export const shopNote: SurfaceEntity = entityOf('shop.note', 'nte', {
  item: refTo('shop.item', 'itm'),
});
export const shopTag: SurfaceEntity = entityOf('shop.tag', 'tag', {});

/** The surface holding the three shop entities. */
export const shopSurface = surfaceOf([], { entities: [shopItem, shopNote, shopTag] });

/** The entity of a ref in the shop surface. */
export const shopEntityOf = (ref: string): SurfaceEntity | undefined =>
  shopSurface.entities.find((entity) => entity.ref === ref);
