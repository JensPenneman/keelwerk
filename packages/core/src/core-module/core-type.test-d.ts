import { describe, expectTypeOf, test } from 'vitest';
import type { derivedCoreBase } from '../../test/derived-core-base.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineModule } from '../dsl/define-module.ts';
import type { Id } from '../ids/id.ts';
import type { ActionRef } from '../model/action-ref.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { Insert } from '../model/insert.ts';
import type { Row } from '../model/row.ts';
import { create as createBackend } from './actions/backend/create.ts';
import { capabilities } from './actions/capabilities.ts';
import { composition } from './actions/composition.ts';
import { evaluate as evaluateFlag } from './actions/flag/evaluate.ts';
import { restoreRules } from './actions/flag/restore-rules.ts';
import { set as setFlag } from './actions/flag/set.ts';
import { introspect } from './actions/introspect.ts';
import { me } from './actions/me.ts';
import { issue } from './actions/operator-token/issue.ts';
import { revoke } from './actions/operator-token/revoke.ts';
import { create as createTenant } from './actions/tenant/create.ts';
import { enter } from './actions/tenant/enter.ts';
import { setApiVersion } from './actions/tenant/set-api-version.ts';
import { coreBase } from './base.ts';
import type { CoreBase } from './core-base-type.ts';
import type { Core } from './core-type.ts';
import { core } from './module.ts';
import { operators as backendOperators } from './policies/backend/operators.ts';
import { submitter } from './policies/command-receipt/submitter.ts';
import { operators as compositionOperators } from './policies/composition/operators.ts';
import { operators as domainOperators } from './policies/domain/operators.ts';
import { operators as flagOperators } from './policies/flag/operators.ts';
import { signedIn as introspectSignedIn } from './policies/introspect/signed-in.ts';
import { operators as operatorTokenOperators } from './policies/operator-token/operators.ts';
import { operators as tenantOperators } from './policies/tenant/operators.ts';
import { syncDomains } from './reactions/sync-domains.ts';
import { syncDomainsOnChange } from './reactions/sync-domains-on-change.ts';

// What `defineModule` derives from the same base and the same parts.
const derivedCore = defineModule(coreBase, {
  actions: { introspect, composition, me, capabilities },
  entityActions: {
    backend: { create: createBackend },
    tenant: { create: createTenant, enter, setApiVersion },
    operatorToken: { issue, revoke },
    flag: { set: setFlag, restoreRules, evaluate: evaluateFlag },
  },
  policies: {
    introspect: { signedIn: introspectSignedIn },
    composition: { operators: compositionOperators },
    operatorToken: { operators: operatorTokenOperators },
    backend: { operators: backendOperators },
    tenant: { operators: tenantOperators },
    domain: { operators: domainOperators },
    flag: { operators: flagOperators },
    commandReceipt: { submitter },
  },
  reactions: { syncDomains, syncDomainsOnChange },
});

const app = defineApp({ id: 'only-core', modules: [] });
type OnlyCore = typeof app;

describe('the hand-written core module types (decision 104, S-11, S-26)', () => {
  test('CoreBase is what the DSL derives from the entity definitions', () => {
    expectTypeOf<CoreBase>().toEqualTypeOf<typeof derivedCoreBase>();
    expectTypeOf<CoreBase>().toExtend<AnyModuleBase>();
  });

  test('Core is a module of the app model and the value is typed Core', () => {
    expectTypeOf<Core>().toExtend<AnyModule>();
    expectTypeOf(core).toEqualTypeOf<Core>();
    expectTypeOf(derivedCore).toEqualTypeOf<Core>();
    expectTypeOf<Core['id']>().toEqualTypeOf<'core'>();
    expectTypeOf<OnlyCore['modules']>().toEqualTypeOf<readonly [Core]>();
  });

  test('the entities of S-26 and their fields', () => {
    expectTypeOf<keyof Core['entities']>().toEqualTypeOf<
      | 'backend'
      | 'tenant'
      | 'domain'
      | 'placement'
      | 'namespace'
      | 'operatorToken'
      | 'commandReceipt'
      | 'effect'
      | 'process'
      | 'flag'
    >();
    expectTypeOf<Row<OnlyCore, 'core.backend'>['name']>().toEqualTypeOf<string>();
    expectTypeOf<Row<OnlyCore, 'core.backend'>['status']>().toEqualTypeOf<'active' | 'suspended'>();
    expectTypeOf<Row<OnlyCore, 'core.tenant'>['backendId']>().toEqualTypeOf<Id<'core.backend'>>();
    expectTypeOf<Row<OnlyCore, 'core.tenant'>['domains']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<Row<OnlyCore, 'core.domain'>['tenantId']>().toEqualTypeOf<Id<'core.tenant'>>();
    expectTypeOf<Row<OnlyCore, 'core.operatorToken'>>().not.toHaveProperty('verifier');
  });

  test('the rows keep the insert shape the api sketch passes', () => {
    expectTypeOf<{
      name: 'acme';
      app: 'portal';
      placement: 'default';
    }>().toExtend<Insert<OnlyCore, 'core.backend'>>();
    expectTypeOf<{
      backendId: Id<'core.backend'>;
      name: 'Acme NV';
      domains: readonly ['acme.example'];
    }>().toExtend<Insert<OnlyCore, 'core.tenant'>>();
  });

  test('the actions of M1 are references of every app; set operations are off where S-26 says', () => {
    expectTypeOf<
      | 'core.backend.create'
      | 'core.backend.get'
      | 'core.backend.update'
      | 'core.tenant.create'
      | 'core.tenant.enter'
      | 'core.tenant.setApiVersion'
      | 'core.domain.get'
      | 'core.domain.query'
      | 'core.operatorToken.issue'
      | 'core.operatorToken.revoke'
      | 'core.introspect'
      | 'core.composition'
      | 'core.me'
      | 'core.capabilities'
      | 'core.commandReceipt.get'
      | 'core.effect.get'
      | 'core.flag.set'
      | 'core.flag.restoreRules'
      | 'core.flag.evaluate'
      | 'core.flag.get'
      | 'core.flag.query'
      | 'core.flag.history'
    >().toExtend<ActionRef<OnlyCore>>();
    expectTypeOf<
      | 'core.domain.create'
      | 'core.placement.create'
      | 'core.namespace.set'
      | 'core.commandReceipt.create'
      | 'core.effect.update'
      | 'core.process.archive'
      | 'core.operatorToken.create'
      | 'core.flag.create'
      | 'core.flag.update'
    >().not.toExtend<ActionRef<OnlyCore>>();
  });
});
