import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

/** A deployment-level entity. */
export const conformanceNetwork: EntityDescriptor = conformanceEntity(
  'conf.network',
  'deployment',
  { name: conformanceField('string', 'name') },
);
