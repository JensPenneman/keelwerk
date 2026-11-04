import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.placement` entity (S-26). */
export const placement: CoreBase['entities']['placement'] = defineEntity({
  prefix: 'plc',
  fields: {
    name: field.string().unique(),
    adapter: field.string(),
    strategy: field.enum(['shared-tables', 'schema-per-tenant', 'database-per-tenant']),
  },
  tenancy: 'deployment',
  generated: { set: false },
});
