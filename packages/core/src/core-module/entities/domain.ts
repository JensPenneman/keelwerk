import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.domain` entity (S-26). */
export const domain: CoreBase['entities']['domain'] = defineEntity({
  prefix: 'dom',
  fields: {
    hostname: field.string().unique(),
    backendId: field.ref.own('backend'),
    tenantId: field.ref.own('tenant'),
  },
  tenancy: 'deployment',
  generated: { set: false },
});
