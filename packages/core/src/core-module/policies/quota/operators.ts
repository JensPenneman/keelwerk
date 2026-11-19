import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { quota } from '../../entities/quota.ts';

/** Operators manage the control store's `core.quota` rows (S-142); no other principal reads or writes them. */
export const operators: CoreLiteral['policies']['quota']['operators'] = defineRule(
  coreBase,
  quota,
  {
    effect: 'allow',
    actions: ['*'],
    principal: 'operator',
    reason: "Operators manage the deployment's quota overrides.",
  },
);
