import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

/** The join entity between items and labels. */
export const itemLabel: EntityDescriptor = entityOf('app.item_label', 'app__item_label', 'tenant', {
  itemId: fieldOf('ref', 'item_id', { optional: false }),
  labelId: fieldOf('ref', 'label_id', { optional: false }),
});
