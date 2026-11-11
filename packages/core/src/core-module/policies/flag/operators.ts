import { defineRule } from '../../../dsl/define-rule.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { flag } from '../../entities/flag.ts';

/** Operators manage the control store's `core.flag` rows (20.4); no other principal reads or writes them. */
export const operators: CoreLiteral['policies']['flag']['operators'] = defineRule(coreBase, flag, {
  effect: 'allow',
  actions: ['*'],
  principal: 'operator',
  reason: "Operators manage the deployment's flag targeting.",
});
