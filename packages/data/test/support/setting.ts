import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

/** A backend-level entity. */
export const setting: EntityDescriptor = entityOf('app.setting', 'app__setting', 'backend', {
  name: fieldOf('string', 'name'),
});
