import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { domain } from '../../entities/domain.ts';

/** Operators manage the control store's `core.domain` rows (S-26); no other principal reaches them. */
export const operators: CoreLiteral['policies']['domain']['operators'] = defineRule(
  coreBase,
  domain,
  {
    effect: 'allow',
    actions: ['*'],
    principal: 'operator',
    reason: "Operators manage the deployment's domain rows.",
  },
);
