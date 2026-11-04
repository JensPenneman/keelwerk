import { defineRule } from '../../../dsl/define-rule.ts';
import { introspect } from '../../actions/introspect.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';

/** `core.introspect` is open to every principal that is signed in (section 16.2.5). */
export const signedIn: CoreLiteral['policies']['introspect']['signedIn'] = defineRule(
  coreBase,
  introspect,
  {
    effect: 'allow',
    principal: ['user', 'service', 'operator'],
    reason: 'Any signed-in principal reads the API surface.',
  },
);
