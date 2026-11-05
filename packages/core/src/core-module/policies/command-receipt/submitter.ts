import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { commandReceipt } from '../../entities/command-receipt.ts';

/**
 * The submitter of a command may follow the `Location` of its 202 (section 15.1.7). The condition
 * compares the flat `principalResolver` and `principalId` columns (a principal is the pair, section 8.5); a caller without a principal reference yields `undefined`,
 * which matches no row (section 8.3).
 */
export const submitter: CoreLiteral['policies']['commandReceipt']['submitter'] = defineRule(
  coreBase,
  commandReceipt,
  {
    effect: 'allow',
    actions: ['get'],
    where: (ctx) => ({
      principalResolver: ctx.principal.ref?.resolver,
      principalId: ctx.principal.ref?.principalId,
    }),
    reason: 'The submitter may read its own receipt.',
  },
);
