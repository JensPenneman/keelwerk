import { defineModule } from '../dsl/define-module.ts';
import { capabilities } from './actions/capabilities.ts';
import { composition } from './actions/composition.ts';
import { introspect } from './actions/introspect.ts';
import { me } from './actions/me.ts';
import { issue } from './actions/operator-token/issue.ts';
import { revoke } from './actions/operator-token/revoke.ts';
import { enter } from './actions/tenant/enter.ts';
import { setApiVersion } from './actions/tenant/set-api-version.ts';
import { coreBase } from './base.ts';
import type { Core } from './core-type.ts';
import { operators as backendOperators } from './policies/backend/operators.ts';
import { operators } from './policies/composition/operators.ts';
import { operators as domainOperators } from './policies/domain/operators.ts';
import { signedIn } from './policies/introspect/signed-in.ts';
import { operators as operatorTokenOperators } from './policies/operator-token/operators.ts';
import { operators as tenantOperators } from './policies/tenant/operators.ts';
import { syncDomains } from './reactions/sync-domains.ts';
import { syncDomainsOnChange } from './reactions/sync-domains-on-change.ts';

/** The implicit core module, always first in a selection (section 4.7). */
export const core: Core = defineModule(coreBase, {
  actions: { introspect, composition, me, capabilities },
  entityActions: { tenant: { enter, setApiVersion }, operatorToken: { issue, revoke } },
  policies: {
    introspect: { signedIn },
    composition: { operators },
    operatorToken: { operators: operatorTokenOperators },
    backend: { operators: backendOperators },
    tenant: { operators: tenantOperators },
    domain: { operators: domainOperators },
  },
  reactions: { syncDomains, syncDomainsOnChange },
});
