import { defineRule } from '../../../dsl/define-rule.ts';
import { apiUsage } from '../../actions/api-usage.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';

/** `core.apiUsage` is for operators only. */
export const operators: CoreLiteral['policies']['apiUsage']['operators'] = defineRule(
  coreBase,
  apiUsage,
  {
    effect: 'allow',
    principal: 'operator',
    reason: 'Operators read the API usage.',
  },
);
