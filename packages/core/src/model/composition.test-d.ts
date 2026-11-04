import { describe, expectTypeOf, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { contracts } from '../dsl/contracts.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineModule } from '../dsl/define-module.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { defineQuery } from '../dsl/define-query.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { Id } from '../ids/id.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { SubjectId } from '../ids/subject-id.ts';
import type { Empty } from '../types/empty.ts';
import type { ActionRef } from './action-ref.ts';
import type { AnyModule } from './any-module.ts';
import type { AppActionTree } from './app-action-tree.ts';
import type { AppChecks } from './app-checks.ts';
import type { AppEntities } from './app-entities.ts';
import type { EntityChange } from './entity-change.ts';
import type { Insert } from './insert.ts';
import type { OfflinePatch } from './offline-patch.ts';
import type { Patch } from './patch.ts';
import type { Readable } from './readable.ts';
import type { Row } from './row.ts';

const selection = [accounts, teams, auth] as const;

const health = defineQuery(selection, {
  output: shape({ ok: field.boolean() }),
  read: () => ({ ok: true }),
});

const full = defineApp({
  id: 'full',
  modules: selection,
  actions: { health },
  execution: { 'auth.credential.revoke': 'async' },
  authorization: { mode: 'strict', decisionLog: 'denials' },
  policies: { disable: [] },
});

type Full = typeof full;

const live = defineModule(
  defineModuleBase({
    id: 'live',
    version: '0.1.0',
    provides: [contracts.live],
    generates: ['watch'],
  }),
  {},
);

const liveUser = defineModule(
  defineModuleBase({ id: 'live-user', version: '0.1.0', requires: [contracts.live] }),
  {},
);

const views = defineModule(
  defineModuleBase({
    id: 'views',
    version: '0.1.0',
    entities: {
      stat: defineEntity({
        prefix: 'stat',
        fields: { total: field.integer() },
        history: 'projection',
      }),
      audit: defineEntity({
        prefix: 'aud',
        fields: { line: field.string() },
        generated: { set: false, history: true },
      }),
      mirror: defineEntity({ prefix: 'mir', fields: { url: field.string() }, history: 'external' }),
    },
  }),
  {},
);

describe('case 1: [accounts, teams, auth]', () => {
  test('rows carry own, contributed, conditional and own-reference fields', () => {
    expectTypeOf<Row<Full, 'accounts.profile'>>().toEqualTypeOf<{
      readonly id: Id<'accounts.profile'>;
      readonly createdAt: Temporal.Instant;
      readonly updatedAt: Temporal.Instant;
      readonly archivedAt?: Temporal.Instant | undefined;
      readonly version: number;
      readonly displayName: string;
      readonly email: string;
      readonly locale?: string | undefined;
      readonly deactivatedAt?: Temporal.Instant | undefined;
      readonly lastLoginAt?: Temporal.Instant | undefined;
      readonly lastCredentialId?: Id<'auth.credential'> | undefined;
      readonly defaultTeamName?: string | undefined;
    }>();
    expectTypeOf<Row<Full, 'auth.credential'>>().toEqualTypeOf<{
      readonly id: Id<'auth.credential'>;
      readonly createdAt: Temporal.Instant;
      readonly updatedAt: Temporal.Instant;
      readonly archivedAt?: Temporal.Instant | undefined;
      readonly version: number;
      readonly subject: SubjectId;
      readonly kind: 'password' | 'passkey';
      readonly identifier?: string | undefined;
      readonly recoveryKey?: SecretRef | undefined;
      readonly lastUsedAt?: Temporal.Instant | undefined;
      readonly revokedAt?: Temporal.Instant | undefined;
      readonly profileId?: Id<'accounts.profile'> | undefined;
    }>();
    expectTypeOf<Row<Full, 'auth.session'>['credentialId']>().toEqualTypeOf<
      Id<'auth.credential'>
    >();
    expectTypeOf<Row<Full, 'core.tenant'>['backendId']>().toEqualTypeOf<Id<'core.backend'>>();
  });

  test('action references: contributed, conditional, generated, core and app actions', () => {
    expectTypeOf<
      | 'accounts.profile.resetPassword'
      | 'accounts.whoami'
      | 'auth.linkProfile'
      | 'accounts.profile.get'
      | 'accounts.profile.archive'
      | 'accounts.profile.search'
      | 'core.tenant.create'
      | 'core.introspect'
      | 'app.health'
    >().toExtend<ActionRef<Full>>();
    expectTypeOf<'accounts.profile.watch'>().not.toExtend<ActionRef<Full>>();
    expectTypeOf<'accounts.profile.history'>().not.toExtend<ActionRef<Full>>();
    expectTypeOf<
      'core.commandReceipt.create' | 'auth.credential.update' | 'auth.session.set'
    >().not.toExtend<ActionRef<Full>>();
    expectTypeOf<'auth.sessionEvents'>().not.toExtend<ActionRef<Full>>();
  });

  test('the action tree carries input, output, errors, events and the effective execution (checklist 9)', () => {
    type Tree = AppActionTree<Full>;
    expectTypeOf<Tree['auth']['entities']['credential']['revoke']>().toEqualTypeOf<{
      readonly kind: 'command';
      readonly input: {
        readonly reason?: string | undefined;
        readonly id: Id<'auth.credential'>;
        readonly ifVersion?: number;
      };
      readonly output: Readable<Full, 'auth.credential'>;
      readonly errors: never;
      readonly events: never;
      readonly execution: 'async';
    }>();
    type RegisterErrors = Tree['accounts']['actions']['register']['errors'];
    expectTypeOf<RegisterErrors['code']>().toEqualTypeOf<
      'accounts.email_taken' | 'accounts.registration_disabled'
    >();
    expectTypeOf<
      Extract<RegisterErrors, { readonly code: 'accounts.email_taken' }>
    >().toEqualTypeOf<{
      readonly code: 'accounts.email_taken';
      readonly data: { readonly email: string };
    }>();
    expectTypeOf<Tree['accounts']['actions']['register']['output']>().toEqualTypeOf<{
      readonly profileId: Id<'accounts.profile'>;
    }>();
    expectTypeOf<Tree['accounts']['entities']['profile']['search']['input']>().toEqualTypeOf<{
      readonly text: string;
      readonly first?: number;
      readonly after?: string;
    }>();
    expectTypeOf<
      Tree['accounts']['entities']['profile']['search']['output']['items'][number]['lastLoginAt']
    >().toEqualTypeOf<Temporal.Instant | undefined>();
    expectTypeOf<Tree['auth']['actions']['login']['input']>().toEqualTypeOf<{
      readonly identifier: string;
      readonly password: string;
    }>();
    expectTypeOf<Tree['accounts']['entities']['profile']['create']['input']>().toEqualTypeOf<
      Insert<Full, 'accounts.profile'>
    >();
    expectTypeOf<Tree['app']['actions']['health']['output']>().toEqualTypeOf<{
      readonly ok: boolean;
    }>();
    expectTypeOf<
      Tree['accounts']['entities']['profile']['deactivate']['execution']
    >().toEqualTypeOf<'sync'>();
  });

  test('Readable makes maskable fields optional; hidden fields never appear', () => {
    expectTypeOf<Readable<Full, 'accounts.profile'>>()
      .toHaveProperty('email')
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Row<Full, 'accounts.profile'>['email']>().toEqualTypeOf<string>();
    expectTypeOf<Row<Full, 'auth.credential'>>().not.toHaveProperty('verifier');
  });

  test('Insert, Patch and OfflinePatch (checklist 9)', () => {
    expectTypeOf<Insert<Full, 'accounts.profile'>>().toEqualTypeOf<{
      readonly displayName: string;
      readonly email: string;
      readonly locale?: string | undefined;
      readonly deactivatedAt?: Temporal.Instant | undefined;
      readonly lastLoginAt?: Temporal.Instant | undefined;
      readonly lastCredentialId?: Id<'auth.credential'> | undefined;
      readonly defaultTeamName?: string | undefined;
    }>();
    expectTypeOf<Patch<Full, 'accounts.profile'>>().toEqualTypeOf<{
      readonly displayName?: string;
      readonly email?: string;
      readonly locale?: string | null;
      readonly deactivatedAt?: Temporal.Instant | null;
      readonly lastLoginAt?: Temporal.Instant | null;
      readonly lastCredentialId?: Id<'auth.credential'> | null;
      readonly defaultTeamName?: string | null;
    }>();
    expectTypeOf<OfflinePatch<Full, 'accounts.profile'>>().not.toHaveProperty('email');
    expectTypeOf<OfflinePatch<Full, 'accounts.profile'>>().toHaveProperty('displayName');
  });
});

describe('cases 2 to 4: toggling', () => {
  test('without auth its contributions and entities are gone', () => {
    const app = defineApp({ id: 'no-auth', modules: [accounts, teams] });
    expectTypeOf<Row<typeof app, 'accounts.profile'>>().not.toHaveProperty('lastLoginAt');
    // @ts-expect-error entities.auth does not exist
    expectTypeOf<AppEntities<typeof app>['auth']>().toBeNever();
  });

  test('without accounts auth stands alone', () => {
    const app = defineApp({ id: 'no-accounts', modules: [auth] });
    expectTypeOf<Row<typeof app, 'auth.credential'>>().not.toHaveProperty('profileId');
    expectTypeOf<'auth.linkProfile' | 'accounts.whoami'>().not.toExtend<ActionRef<typeof app>>();
    expectTypeOf<'auth.login'>().toExtend<ActionRef<typeof app>>();
  });

  test('without teams the when-teams contribution drops and the unconditional one stays', () => {
    const app = defineApp({ id: 'no-teams', modules: [accounts, auth] });
    expectTypeOf<Row<typeof app, 'accounts.profile'>>().not.toHaveProperty('defaultTeamName');
    expectTypeOf<Row<typeof app, 'accounts.profile'>>().toHaveProperty('lastLoginAt');
  });
});

describe('case 11 and checklist 7: generated actions', () => {
  test('history modes, generated switches and the watch template', () => {
    const app = defineApp({ id: 'views', modules: [views] });
    expectTypeOf<
      'views.stat.get' | 'views.stat.query' | 'views.stat.changes' | 'views.stat.queryChanges'
    >().toExtend<ActionRef<typeof app>>();
    expectTypeOf<'views.stat.create' | 'views.stat.set'>().not.toExtend<ActionRef<typeof app>>();
    expectTypeOf<'views.audit.history'>().toExtend<ActionRef<typeof app>>();
    expectTypeOf<
      | 'views.audit.set'
      | 'views.audit.create'
      | 'views.audit.update'
      | 'views.audit.archive'
      | 'views.audit.restore'
    >().not.toExtend<ActionRef<typeof app>>();
    expectTypeOf<'views.mirror.get' | 'views.mirror.query'>().toExtend<ActionRef<typeof app>>();
    expectTypeOf<'views.mirror.changes'>().not.toExtend<ActionRef<typeof app>>();
  });

  test('a generator module adds watch, typed as EntityChange of the row, to every non-external entity', () => {
    const app = defineApp({ id: 'live-views', modules: [views, live] });
    expectTypeOf<'views.stat.watch' | 'views.audit.watch' | 'core.tenant.watch'>().toExtend<
      ActionRef<typeof app>
    >();
    expectTypeOf<'views.mirror.watch'>().not.toExtend<ActionRef<typeof app>>();
    expectTypeOf<
      AppActionTree<typeof app>['views']['entities']['stat']['watch']['events']
    >().toEqualTypeOf<EntityChange<Readable<typeof app, 'views.stat'>>>();
  });

  test('requiring the live contract without a provider fails with missingModules', () => {
    expectTypeOf<AppChecks<readonly [typeof liveUser], Empty, Empty>>().toEqualTypeOf<{
      readonly missingModules: 'live';
    }>();
    // @ts-expect-error missingModules: 'live'
    defineApp({ id: 'x', modules: [liveUser] });
    defineApp({ id: 'x', modules: [liveUser, live] });
  });
});

describe('case 13: a conditional part keyed on a contract', () => {
  test('present with a provider, absent without', () => {
    const withLive = defineApp({ id: 'x', modules: [accounts, auth, live] });
    expectTypeOf<'auth.sessionEvents'>().toExtend<ActionRef<typeof withLive>>();
    expectTypeOf<
      AppActionTree<typeof withLive>['auth']['actions']['sessionEvents']['events']
    >().toEqualTypeOf<{
      readonly sessionId: Id<'auth.session'>;
      readonly kind: 'created' | 'revoked';
    }>();
    const without = defineApp({ id: 'x', modules: [accounts, auth] });
    expectTypeOf<'auth.sessionEvents'>().not.toExtend<ActionRef<typeof without>>();
  });
});

describe('section 4.7 properties', () => {
  test('the constraints never mention any (a single any would collapse UnionToIntersection)', () => {
    expectTypeOf<AnyModule>().not.toBeAny();
    expectTypeOf<NonNullable<AnyModule['entities']>[string]>().not.toBeAny();
    expectTypeOf<NonNullable<AnyModule['contributes']>[number]>().not.toBeAny();
    expectTypeOf<NonNullable<AnyModule['actions']>[string]['~types']>().not.toBeAny();
    expectTypeOf<Row<Full, 'accounts.profile'>['displayName']>().not.toBeAny();
  });
});
