import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

export const global: EntityDescriptor = entityOf('app.global', 'app__global', 'deployment', {
  name: fieldOf('string', 'name'),
});
