import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.process` entity (S-26). */
export const process: CoreBase['entities']['process'] = defineEntity({
  prefix: 'proc',
  fields: {
    name: field.string().optional(),
    node: field.string(),
    roles: field.list(field.enum(['serve', 'work'])),
    buildId: field.string(),
    revision: field.integer(),
    state: field.enum(['starting', 'ready', 'draining', 'stopped']),
    heartbeatAt: field.instant(),
  },
  tenancy: 'deployment',
  history: 'state',
  generated: { set: false },
});
