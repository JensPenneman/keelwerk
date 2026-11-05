import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { CoreBase } from '../core-base-type.ts';

/** The `core.operatorToken` entity (S-26). */
export const operatorToken: CoreBase['entities']['operatorToken'] = defineEntity({
  prefix: 'otk',
  fields: {
    label: field.string(),
    verifier: field.verifier(),
    expiresAt: field.instant(),
    revokedAt: field.instant().optional(),
    publicId: field.string().unique(),
  },
  tenancy: 'deployment',
  generated: { set: false },
});
