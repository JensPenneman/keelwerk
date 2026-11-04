import { describe, expectTypeOf, test } from 'vitest';
import { defineApp } from '../dsl/define-app.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineModule } from '../dsl/define-module.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import type { AdmissionRule } from '../edge/admission-rule.ts';
import type { PrincipalEnricher } from '../edge/principal-enricher.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import { field } from '../fields/field.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { Id } from '../ids/id.ts';
import type { ActionRef } from '../model/action-ref.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { AppActionTree } from '../model/app-action-tree.ts';
import type { Insert } from '../model/insert.ts';
import type { Row } from '../model/row.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import { capabilities } from './actions/capabilities.ts';
import { composition } from './actions/composition.ts';
import { introspect } from './actions/introspect.ts';
import { me } from './actions/me.ts';
import { revoke } from './actions/operator-token/revoke.ts';
import { enter } from './actions/tenant/enter.ts';
import { setApiVersion } from './actions/tenant/set-api-version.ts';
import { coreBase } from './base.ts';
import type { CoreBase } from './core-base-type.ts';
import type { Core } from './core-type.ts';
import { core } from './module.ts';

declare const configSchema: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>>;
const status = field.enum(['active', 'suspended']).default('active');

// What the DSL derives from the same definitions, with isolatedDeclarations off: the hand-written
// `CoreBase` must be exactly this (decision 104).
const derived = defineModuleBase({
  id: 'core',
  version: '0.0.0',
  extensionPoints: {
    transports: extensionPoint.set<TransportAdapter>(),
    principalResolvers: extensionPoint.ordered<PrincipalResolver>(),
    principalEnrichers: extensionPoint.set<PrincipalEnricher>(),
    invocationMiddleware: extensionPoint.ordered<AdmissionRule>(),
  },
  entities: {
    backend: defineEntity({
      prefix: 'bknd',
      fields: {
        name: field.string().unique(),
        app: field.string(),
        placement: field.string(),
        apiVersion: field.string().optional(),
        config: field.json(configSchema).optional(),
        status,
      },
      tenancy: 'deployment',
    }),
    tenant: defineEntity({
      prefix: 'tnt',
      fields: {
        backendId: field.ref.own('backend'),
        name: field.string(),
        placement: field.string().optional(),
        apiVersion: field.string().optional(),
        domains: field.list(field.string()),
        status,
      },
      tenancy: 'deployment',
    }),
    domain: defineEntity({
      prefix: 'dom',
      fields: {
        hostname: field.string().unique(),
        backendId: field.ref.own('backend'),
        tenantId: field.ref.own('tenant'),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    placement: defineEntity({
      prefix: 'plc',
      fields: {
        name: field.string().unique(),
        adapter: field.string(),
        strategy: field.enum(['shared-tables', 'schema-per-tenant', 'database-per-tenant']),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    namespace: defineEntity({
      prefix: 'nsp',
      fields: {
        placementId: field.ref.own('placement'),
        appId: field.string(),
        tenantId: field.ref.own('tenant').optional(),
        root: field.string(),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    operatorToken: defineEntity({
      prefix: 'otk',
      fields: {
        label: field.string(),
        verifier: field.verifier(),
        expiresAt: field.instant(),
        revokedAt: field.instant().optional(),
      },
      tenancy: 'deployment',
      generated: { set: false },
    }),
    commandReceipt: defineEntity({
      prefix: 'rcpt',
      fields: {
        commandId: field.string(),
        status: field.enum(['accepted', 'succeeded', 'failed']),
      },
      history: 'state',
      tenancy: 'invocation',
      generated: { set: false },
    }),
    effect: defineEntity({
      prefix: 'eff',
      fields: {
        type: field.string(),
        commandId: field.string(),
        status: field.enum(['requested', 'succeeded', 'failed', 'abandoned']),
        attempts: field.integer().default(0),
      },
      tenancy: 'invocation',
      generated: { set: false },
    }),
    process: defineEntity({
      prefix: 'proc',
      fields: {
        name: field.string().optional(),
        node: field.string(),
        roles: field.list(field.enum(['serve', 'work'])),
        buildId: field.string(),
        revision: field.integer(),
        state: field.enum(['starting', 'ready', 'draining', 'stopped']),
        heartbeatAt: field.instant(),
      },
      tenancy: 'deployment',
      history: 'state',
      generated: { set: false },
    }),
  },
});

// What `defineModule` derives from the same base and the same parts.
const derivedCore = defineModule(coreBase, {
  actions: { introspect, composition, me, capabilities },
  entityActions: { tenant: { enter, setApiVersion }, operatorToken: { revoke } },
});

const app = defineApp({ id: 'only-core', modules: [] });
type OnlyCore = typeof app;
type Tree = AppActionTree<OnlyCore>;

describe('the hand-written core module types (decision 104, S-11, S-26)', () => {
  test('CoreBase is what the DSL derives from the entity definitions', () => {
    expectTypeOf<CoreBase>().toEqualTypeOf<typeof derived>();
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
    >();
    expectTypeOf<Row<OnlyCore, 'core.backend'>['name']>().toEqualTypeOf<string>();
    expectTypeOf<Row<OnlyCore, 'core.backend'>['status']>().toEqualTypeOf<'active' | 'suspended'>();
    expectTypeOf<Row<OnlyCore, 'core.tenant'>['backendId']>().toEqualTypeOf<Id<'core.backend'>>();
    expectTypeOf<Row<OnlyCore, 'core.tenant'>['domains']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<Row<OnlyCore, 'core.domain'>['tenantId']>().toEqualTypeOf<Id<'core.tenant'>>();
    expectTypeOf<Row<OnlyCore, 'core.operatorToken'>>().not.toHaveProperty('verifier');
  });

  test('the generated create takes what the api sketch passes', () => {
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
    expectTypeOf<Tree['core']['entities']['backend']['create']['input']>().toEqualTypeOf<
      Insert<OnlyCore, 'core.backend'>
    >();
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
      | 'core.operatorToken.revoke'
      | 'core.introspect'
      | 'core.composition'
      | 'core.me'
      | 'core.capabilities'
      | 'core.commandReceipt.get'
      | 'core.effect.get'
    >().toExtend<ActionRef<OnlyCore>>();
    expectTypeOf<
      | 'core.domain.create'
      | 'core.placement.create'
      | 'core.namespace.set'
      | 'core.commandReceipt.create'
      | 'core.effect.update'
      | 'core.process.archive'
      | 'core.operatorToken.create'
      | 'core.operatorToken.issue'
    >().not.toExtend<ActionRef<OnlyCore>>();
  });

  test('the commands carry their input and the instance id', () => {
    expectTypeOf<Tree['core']['entities']['tenant']['enter']['input']>().toEqualTypeOf<{
      readonly reason: string;
      readonly id: Id<'core.tenant'>;
      readonly ifVersion?: number;
    }>();
    expectTypeOf<
      Tree['core']['entities']['tenant']['setApiVersion']['input']['apiVersion']
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Tree['core']['entities']['operatorToken']['revoke']['kind']
    >().toEqualTypeOf<'command'>();
    expectTypeOf<Tree['core']['entities']['tenant']['enter']['kind']>().toEqualTypeOf<'command'>();
    expectTypeOf<Tree['core']['actions']['introspect']['kind']>().toEqualTypeOf<'query'>();
  });
});
