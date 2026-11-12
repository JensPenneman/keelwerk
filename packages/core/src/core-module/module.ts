import { defineModule } from '../dsl/define-module.ts';
import { apiUsage } from './actions/api-usage.ts';
import { create as createBackend } from './actions/backend/create.ts';
import { capabilities } from './actions/capabilities.ts';
import { composition } from './actions/composition.ts';
import { effectStatus } from './actions/effect-status.ts';
import { effectStatusWatch } from './actions/effect-status-watch.ts';
import { eraseSubject } from './actions/erase-subject.ts';
import { evaluate as evaluateFlag } from './actions/flag/evaluate.ts';
import { restoreRules } from './actions/flag/restore-rules.ts';
import { set as setFlag } from './actions/flag/set.ts';
import { introspect } from './actions/introspect.ts';
import { me } from './actions/me.ts';
import { issue } from './actions/operator-token/issue.ts';
import { revoke } from './actions/operator-token/revoke.ts';
import { retireApiVersion } from './actions/retire-api-version.ts';
import { create as createTenant } from './actions/tenant/create.ts';
import { enter } from './actions/tenant/enter.ts';
import { setApiVersion } from './actions/tenant/set-api-version.ts';
import { coreBase } from './base.ts';
import type { Core } from './core-type.ts';
import { operators as apiUsageOperators } from './policies/api-usage/operators.ts';
import { operators as backendOperators } from './policies/backend/operators.ts';
import { submitter } from './policies/command-receipt/submitter.ts';
import { operators } from './policies/composition/operators.ts';
import { operators as domainOperators } from './policies/domain/operators.ts';
import { signedIn as effectStatusSignedIn } from './policies/effect-status/signed-in.ts';
import { signedIn as effectStatusWatchSignedIn } from './policies/effect-status-watch/signed-in.ts';
import { operators as subjectOperators } from './policies/erase-subject/operators.ts';
import { operators as flagOperators } from './policies/flag/operators.ts';
import { signedIn } from './policies/introspect/signed-in.ts';
import { operators as operatorTokenOperators } from './policies/operator-token/operators.ts';
import { operators as retireOperators } from './policies/retire-api-version/operators.ts';
import { operators as tenantOperators } from './policies/tenant/operators.ts';
import { syncDomains } from './reactions/sync-domains.ts';
import { syncDomainsOnChange } from './reactions/sync-domains-on-change.ts';

/** The implicit core module, always first in a selection (section 4.7). */
export const core: Core = defineModule(coreBase, {
  actions: {
    introspect,
    composition,
    me,
    capabilities,
    apiUsage,
    retireApiVersion,
    effectStatus,
    effectStatusWatch,
    eraseSubject,
  },
  entityActions: {
    backend: { create: createBackend },
    tenant: { create: createTenant, enter, setApiVersion },
    operatorToken: { issue, revoke },
    flag: { set: setFlag, restoreRules, evaluate: evaluateFlag },
  },
  policies: {
    introspect: { signedIn },
    composition: { operators },
    apiUsage: { operators: apiUsageOperators },
    retireApiVersion: { operators: retireOperators },
    operatorToken: { operators: operatorTokenOperators },
    backend: { operators: backendOperators },
    tenant: { operators: tenantOperators },
    domain: { operators: domainOperators },
    flag: { operators: flagOperators },
    commandReceipt: { submitter },
    effectStatus: { signedIn: effectStatusSignedIn },
    effectStatusWatch: { signedIn: effectStatusWatchSignedIn },
    eraseSubject: { operators: subjectOperators },
  },
  reactions: { syncDomains, syncDomainsOnChange },
});
