import type { EntityDescriptor } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

/** A backend-level entity: tenants read it through a read-only nested unit. */
export const conformanceSetting: EntityDescriptor = conformanceEntity('conf.setting', 'backend', {
  key: conformanceField('string', 'key', { optional: false, unique: true }),
  value: conformanceField('string', 'value'),
});
