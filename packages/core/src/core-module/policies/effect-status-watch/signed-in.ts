import { defineRule } from '../../../dsl/define-rule.ts';
import { effectStatusWatch } from '../../actions/effect-status-watch.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';

/** A signed-in principal reads the status of the effects its own commands requested (7.9.5); which effects are its own is decided by the submitter reference, not by this rule. */
export const signedIn: CoreLiteral['policies']['effectStatusWatch']['signedIn'] = defineRule(
  coreBase,
  effectStatusWatch,
  {
    effect: 'allow',
    principal: ['user', 'service', 'operator'],
    reason: 'A signed-in principal reads the status of the effects its own commands requested.',
  },
);
