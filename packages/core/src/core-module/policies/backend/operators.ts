import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { backend } from '../../entities/backend.ts';

/** Operators manage the control store's `core.backend` rows (S-26); no other principal reaches them. */
export const operators: CoreLiteral['policies']['backend']['operators'] = defineRule(
  coreBase,
  backend,
  {
    effect: 'allow',
    actions: ['*'],
    principal: 'operator',
    reason: "Operators manage the deployment's backend rows.",
  },
);
