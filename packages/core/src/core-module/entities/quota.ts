import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/**
 * The `core.quota` entity (12.2, S-142): one tenant's override of one dimension. A row always names
 * its tenant; a backend's own values are its configuration (`config.core.quotas`). `slot` stays the
 * row's identity (`quotaSlotOf`: dimension, backend and tenant). A row without `limit` is no
 * override: the operator set it to `default`.
 */
export const quota: CoreBase['entities']['quota'] = defineEntity({
  prefix: 'qta',
  fields: {
    slot: field.string().unique(),
    dimension: field.string(),
    backendId: field.ref.own('backend'),
    tenantId: field.ref.own('tenant'),
    limit: field.string().optional(),
    reason: field.string(),
  },
  tenancy: 'deployment',
  generated: { set: false, history: true },
});
