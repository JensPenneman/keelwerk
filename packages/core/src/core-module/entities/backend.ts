import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';
import { configSchema } from '../shapes/config-schema.ts';

/** The `core.backend` entity (S-26). */
export const backend: CoreBase['entities']['backend'] = defineEntity({
  prefix: 'bknd',
  fields: {
    name: field.string().unique(),
    app: field.string(),
    placement: field.string(),
    apiVersion: field.string().optional(),
    config: field.json(configSchema).optional(),
    status: field.enum(['active', 'suspended']).default('active'),
  },
  tenancy: 'deployment',
  generated: { create: false },
});
