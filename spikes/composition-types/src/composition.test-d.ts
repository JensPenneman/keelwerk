import { describe, expectTypeOf, test } from 'vitest';
import type { AnyModule } from './any-module.ts';
import type { ActionRef, AppActionTree } from './app-action-tree.ts';
import type { AppChecks } from './app-checks.ts';
import type { AppEntities, Insert, OfflinePatch, Patch, Readable, Row } from './app-entities.ts';
import { contracts } from './contracts.ts';
import type { Core } from './core-module.ts';
import { defineApp } from './define-app.ts';
import { defineContribution } from './define-contribution.ts';
import { defineDeployment } from './define-deployment.ts';
import { defineEntity } from './define-entity.ts';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';
import { defineQuery } from './define-query.ts';
import type { EntityChange } from './entity-change.ts';
import { type AbsoluteRef, type FieldDef, field, type NoFlags } from './field.ts';
import { type Accounts, accounts } from './fixtures/accounts/module.generated.ts';
import { type Auth, auth } from './fixtures/auth/module.generated.ts';
import { type Teams, teams } from './fixtures/teams/module.generated.ts';
import type { Id, SecretRef, SubjectId } from './id.ts';
import { shape } from './shape.ts';

type DanglingRef = FieldDef<Id<'accounts.nope'>, NoFlags, AbsoluteRef<'accounts', 'nope'>, 'ref'>;

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
const blobsUser = defineModule(
  defineModuleBase({ id: 'blob-user', version: '0.1.0', requires: [contracts.blobs] }),
  {},
);
const liveUser = defineModule(
  defineModuleBase({ id: 'live-user', version: '0.1.0', requires: [contracts.live] }),
  {},
);
const directory = defineModule(
  defineModuleBase({ id: 'directory', version: '0.1.0', requires: [accounts] }),
  {},
);
const rival = defineModule(
  defineModuleBase({
    id: 'rival',
    version: '0.1.0',
    optional: [accounts],
    contributions: {
      toAccounts: defineContribution(accounts, {
        entities: { profile: { fields: { lastLoginAt: field.instant().optional() } } },
      }),
    },
  }),
  {},
);
const shadow = defineModule(
  defineModuleBase({
    id: 'shadow',
    version: '0.1.0',
    optional: [accounts],
    contributions: {
      toAccounts: defineContribution(accounts, {
        entities: { profile: { fields: { displayName: field.string().optional() } } },
      }),
    },
  }),
  {},
);
const typo = defineModule(
  defineModuleBase({
    id: 'typo',
    version: '0.1.0',
    optional: [accounts],
    contributions: {
      // @ts-expect-error unknownContributionTargets: accounts has no entity 'profiles'
      toAccounts: defineContribution(accounts, {
        entities: { profiles: { fields: { note: field.string().optional() } } },
      }),
    },
  }),
  {},
);
const dangling = defineModule(
  defineModuleBase({
    id: 'dangling',
    version: '0.1.0',
    requires: [accounts],
    entities: {
      // A reference no builder accepts (the target entity does not exist), forced for the app-level backstop.
      note: defineEntity({
        prefix: 'note',
        fields: { about: field.ref(accounts, 'profile') as unknown as DanglingRef },
      }),
    },
  }),
  {},
);
const fakeCore = defineModule(defineModuleBase({ id: 'core', version: '0.1.0' }), {});
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
    expectTypeOf<Tree['accounts']['actions']['register']['errors']>().toEqualTypeOf<{
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

describe('the five defineApp checks fail with named errors (decision 31a)', () => {
  test('case 5: missingModules', () => {
    expectTypeOf<AppChecks<readonly [typeof directory], {}, {}>>().toEqualTypeOf<{
      readonly missingModules: 'accounts';
    }>();
    // @ts-expect-error missingModules: 'accounts'
    defineApp({ id: 'x', modules: [directory] });
  });

  test('case 6: conflictingFields, own versus contributed and two contributors', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof shadow], {}, {}>>().toEqualTypeOf<{
      readonly conflictingFields: 'accounts.profile.displayName';
    }>();
    expectTypeOf<AppChecks<readonly [Accounts, Auth, typeof rival], {}, {}>>().toEqualTypeOf<{
      readonly conflictingFields: 'accounts.profile.lastLoginAt';
    }>();
    // @ts-expect-error conflictingFields
    defineApp({ id: 'x', modules: [accounts, auth, rival] });
    defineApp({ id: 'x', modules: [accounts, rival] });
  });

  test('case 7: unknownContributionTargets, ignored when the target is absent', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof typo], {}, {}>>().toEqualTypeOf<{
      readonly unknownContributionTargets: 'typo -> accounts.profiles';
    }>();
    // @ts-expect-error unknownContributionTargets
    defineApp({ id: 'x', modules: [accounts, typo] });
    defineApp({ id: 'x', modules: [typo] });
  });

  test('case 8: duplicateModuleIds and reservedModuleIds', () => {
    expectTypeOf<AppChecks<readonly [Accounts, Accounts], {}, {}>>().toEqualTypeOf<{
      readonly duplicateModuleIds: 'accounts';
    }>();
    // @ts-expect-error duplicateModuleIds
    defineApp({ id: 'x', modules: [accounts, accounts] });
    expectTypeOf<AppChecks<readonly [typeof fakeCore], {}, {}>>()
      .toHaveProperty('reservedModuleIds')
      .toEqualTypeOf<'core'>();
    // @ts-expect-error reservedModuleIds
    defineApp({ id: 'x', modules: [fakeCore] });
  });

  test('danglingReferences, the app-level backstop', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof dangling], {}, {}>>().toEqualTypeOf<{
      readonly danglingReferences: 'dangling.note.about -> accounts.nope';
    }>();
    // @ts-expect-error danglingReferences
    defineApp({ id: 'x', modules: [accounts, dangling] });
  });
});

describe('cases 9 and 10: module-level checks, at the base', () => {
  test('a reference to an optional module fails; to a required one it is accepted', () => {
    const profileRef = defineEntity({
      prefix: 'pr',
      fields: { profileId: field.ref(accounts, 'profile').optional().index() },
    });
    // @ts-expect-error refsOutsideRequirements
    defineModuleBase({
      id: 'soft',
      version: '0.1.0',
      optional: [accounts],
      entities: { profileRef },
    });
    const hard = defineModuleBase({
      id: 'hard',
      version: '0.1.0',
      requires: [accounts],
      entities: { profileRef },
    });
    expectTypeOf(hard.entities.profileRef.fields.profileId.ref).toEqualTypeOf<{
      readonly module: 'accounts';
      readonly entity: 'profile';
    }>();
  });

  test('contributed fields must be optional or defaulted', () => {
    const required = defineContribution(accounts, {
      entities: { profile: { fields: { score: field.integer() } } },
    });
    const defaulted = defineContribution(accounts, {
      entities: { profile: { fields: { score: field.integer().default(0) } } },
    });
    // @ts-expect-error contributedFieldsNeedDefault
    defineModuleBase({
      id: 'scores',
      version: '0.1.0',
      optional: [accounts],
      contributions: { required },
    });
    defineModuleBase({
      id: 'scores',
      version: '0.1.0',
      optional: [accounts],
      contributions: { defaulted },
    });
    // @ts-expect-error contributionsOutsideDependencies: accounts is neither required nor optional
    defineModuleBase({ id: 'scores', version: '0.1.0', contributions: { defaulted } });
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
    expectTypeOf<AppChecks<readonly [typeof liveUser], {}, {}>>().toEqualTypeOf<{
      readonly missingModules: 'live';
    }>();
    // @ts-expect-error missingModules: 'live'
    defineApp({ id: 'x', modules: [liveUser] });
    defineApp({ id: 'x', modules: [liveUser, live] });
  });
});

describe('case 12 and checklist 8: defineApp options', () => {
  test('execution overrides name commands only', () => {
    defineApp({
      id: 'x',
      modules: [accounts],
      execution: { 'accounts.profile.deactivate': 'either', 'accounts.profile.create': 'async' },
    });
    // @ts-expect-error unknownExecutionOverrides: a query
    defineApp({ id: 'x', modules: [accounts], execution: { 'accounts.profile.search': 'async' } });
    // @ts-expect-error unknownExecutionOverrides: an unknown reference
    defineApp({ id: 'x', modules: [accounts], execution: { 'accounts.profile.nope': 'async' } });
    // @ts-expect-error authorization mode is 'strict' or 'strip'
    defineApp({ id: 'x', modules: [accounts], authorization: { mode: 'open' } });
  });

  test('the core module is always prepended (checklist 6)', () => {
    expectTypeOf<Full['modules'][0]>().toEqualTypeOf<Core>();
    expectTypeOf<Full['modules']>().toEqualTypeOf<readonly [Core, Accounts, Teams, Auth]>();
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

describe('case 14: defineDeployment', () => {
  test('missingInfrastructure', () => {
    const app = defineApp({ id: 'files', modules: [blobsUser] });
    const deployment = {
      control: { adapter: 'postgres', url: 'postgres://control' },
      placements: {
        default: { adapter: 'postgres', url: 'postgres://data', strategy: 'shared-tables' },
      },
      tenantResolution: [],
    } as const;
    // @ts-expect-error missingInfrastructure: 'blobs'
    defineDeployment({ ...deployment, apps: [app], infrastructure: [] });
    defineDeployment({
      ...deployment,
      apps: [app],
      infrastructure: [{ kind: 'blobs-fs', provides: [contracts.blobs] }],
    });
  });
});
