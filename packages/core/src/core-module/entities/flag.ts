import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import { flagTargetingSchema } from '../../flags/flag-targeting-schema.ts';
import type { CoreBase } from '../core-base-type.ts';

/**
 * The `core.flag` entity (20.4): the targeting of one flag for one backend, or for the whole
 * deployment when `backendId` is absent. `slot` is the row's identity (`<key>` or
 * `<key>@<backendId>`), unique because a unique index over a nullable backend column would let two
 * deployment-wide rows exist. `previous` holds the rule set before the last change, for
 * `restoreRules`; `reason` is the operator's reason for the last change.
 */
export const flag: CoreBase['entities']['flag'] = defineEntity({
  prefix: 'flg',
  fields: {
    slot: field.string().unique(),
    key: field.string(),
    backendId: field.ref.own('backend').optional(),
    targeting: field.json(flagTargetingSchema),
    previous: field.json(flagTargetingSchema).optional(),
    reason: field.string(),
  },
  tenancy: 'deployment',
  generated: { set: false, history: true },
});
