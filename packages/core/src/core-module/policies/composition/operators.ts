import { defineRule } from '../../../dsl/define-rule.ts';
import { composition } from '../../actions/composition.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';

/** `core.composition` is for operators only (section 16.2.6). */
export const operators: CoreLiteral['policies']['composition']['operators'] = defineRule(
  coreBase,
  composition,
  {
    effect: 'allow',
    principal: 'operator',
    reason: 'Operators read the composition report.',
  },
);
