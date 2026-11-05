import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { operatorToken } from '../../entities/operator-token.ts';

/** Operators manage the control store's `core.operatorToken` rows (section 3.5); no other principal reaches them. */
export const operators: CoreLiteral['policies']['operatorToken']['operators'] = defineRule(
  coreBase,
  operatorToken,
  {
    effect: 'allow',
    actions: ['*'],
    principal: 'operator',
    reason: 'Operators issue, list and revoke operator tokens.',
  },
);
