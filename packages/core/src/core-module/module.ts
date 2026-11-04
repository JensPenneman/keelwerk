import { defineModule } from '../dsl/define-module.ts';
import { capabilities } from './actions/capabilities.ts';
import { composition } from './actions/composition.ts';
import { introspect } from './actions/introspect.ts';
import { me } from './actions/me.ts';
import { revoke } from './actions/operator-token/revoke.ts';
import { enter } from './actions/tenant/enter.ts';
import { setApiVersion } from './actions/tenant/set-api-version.ts';
import { coreBase } from './base.ts';
import type { Core } from './core-type.ts';

/** The implicit core module, always first in a selection (section 4.7). */
export const core: Core = defineModule(coreBase, {
  actions: { introspect, composition, me, capabilities },
  entityActions: { tenant: { enter, setApiVersion }, operatorToken: { revoke } },
});
