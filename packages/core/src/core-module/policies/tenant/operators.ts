import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { tenant } from '../../entities/tenant.ts';

/** Operators manage the control store's `core.tenant` rows (S-26); no other principal reaches them. */
export const operators: CoreLiteral['policies']['tenant']['operators'] = defineRule(
  coreBase,
  tenant,
  {
    effect: 'allow',
    actions: ['*'],
    principal: 'operator',
    reason: "Operators manage the deployment's tenant rows.",
  },
);
