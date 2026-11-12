import { defineRule } from '../../../dsl/define-rule.ts';
import { eraseSubject } from '../../actions/erase-subject.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';

/**
 * Operators erase a subject inside a tenant they entered (section 14.7.5). A module adds further
 * rules through its contribution to core (`toCore`): an allow rule applies only to a subject the
 * module holds a row of, and a deny rule refuses every new erasure, the operator's included, until
 * the platform disables it with `policies.disable`. The platform lets a user erase their own
 * subject by adding core's `selfErase` with `policies.add` (section 8.7).
 */
export const operators: CoreLiteral['policies']['eraseSubject']['operators'] = defineRule(
  coreBase,
  eraseSubject,
  {
    effect: 'allow',
    principal: 'operator',
    reason: 'Operators erase the data subjects of a tenant they entered.',
  },
);
