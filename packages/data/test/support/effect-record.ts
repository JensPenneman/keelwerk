import type { EntityDescriptor } from '@keelwerk/core';
import { entityOf } from './entity-of.ts';
import { fieldOf } from './field-of.ts';

/** An invocation-tenancy entity: a row carries the scope of its command (15.1.7). */
export const effectRecord: EntityDescriptor = entityOf(
  'core.effect',
  'core__effect',
  'invocation',
  {
    title: fieldOf('string', 'title'),
  },
);
