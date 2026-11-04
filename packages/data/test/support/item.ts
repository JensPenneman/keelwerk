import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

/** A tenant entity with a many-to-many relation to labels through `item_label`. */
export const item: EntityDescriptor = entityOf(
  'app.item',
  'app__item',
  'tenant',
  { name: fieldOf('string', 'name') },
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
