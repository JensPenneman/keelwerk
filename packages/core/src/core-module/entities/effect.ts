import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.effect` entity (S-26). */
export const effect: CoreBase['entities']['effect'] = defineEntity({
  prefix: 'eff',
  fields: {
    type: field.string(),
    commandId: field.string(),
    status: field.enum(['requested', 'succeeded', 'failed', 'abandoned']),
    attempts: field.integer().default(0),
  },
  tenancy: 'invocation',
  generated: { set: false },
});
