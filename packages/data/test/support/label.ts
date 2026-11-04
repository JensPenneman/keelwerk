import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

export const label: EntityDescriptor = entityOf('app.label', 'app__label', 'tenant', {
  name: fieldOf('string', 'name'),
});
