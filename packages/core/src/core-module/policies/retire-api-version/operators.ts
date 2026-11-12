import { defineRule } from '../../../dsl/define-rule.ts';
import { retireApiVersion } from '../../actions/retire-api-version.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';

/** `core.retireApiVersion` is for operators only. */
export const operators: CoreLiteral['policies']['retireApiVersion']['operators'] = defineRule(
  coreBase,
  retireApiVersion,
  {
    effect: 'allow',
    principal: 'operator',
    reason: 'Operators retire API versions.',
  },
);
