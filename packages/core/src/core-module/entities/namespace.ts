import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.namespace` entity (S-26). */
export const namespace: CoreBase['entities']['namespace'] = defineEntity({
  prefix: 'nsp',
  fields: {
    placementId: field.ref.own('placement'),
    appId: field.string(),
    tenantId: field.ref.own('tenant').optional(),
    root: field.string(),
  },
  tenancy: 'deployment',
  generated: { set: false },
});
