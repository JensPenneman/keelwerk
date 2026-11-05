import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.tenant` entity (S-26). */
export const tenant: CoreBase['entities']['tenant'] = defineEntity({
  prefix: 'tnt',
  fields: {
    backendId: field.ref.own('backend'),
    name: field.string(),
    placement: field.string().optional(),
    apiVersion: field.string().optional(),
    domains: field.list(field.string()),
    status: field.enum(['active', 'suspended']).default('active'),
  },
  events: {
    entered: shape({ reason: field.string() }),
    hookFailed: shape({ hook: field.string() }),
    hookCompleted: shape({ hook: field.string() }),
  },
  evolve: {
    entered: (state) => state,
    hookFailed: (state) => state,
    hookCompleted: (state) => state,
  },
  tenancy: 'deployment',
  generated: { history: true },
});
