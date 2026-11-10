import { describe, expectTypeOf, test } from 'vitest';
import {
  type Accounts,
  accounts,
} from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { type Auth, auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { type Teams, teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import type { Core } from '../core-module/core-type.ts';
import { core } from '../core-module/module.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineCondition } from '../dsl/define-condition.ts';
import { defineContribution } from '../dsl/define-contribution.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineModule } from '../dsl/define-module.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { defineQuery } from '../dsl/define-query.ts';
import { field } from '../fields/field.ts';
import type { AbsoluteRef, FieldDef } from '../fields/field-def.ts';
import type { NoFlags, WithFlag } from '../fields/field-flags.ts';
import { shape } from '../fields/shape.ts';
import type { Id } from '../ids/id.ts';
import type { Empty } from '../types/empty.ts';
import type { AppChecks } from './app-checks.ts';

type DanglingRef = FieldDef<Id<'accounts.nope'>, NoFlags, AbsoluteRef<'accounts', 'nope'>, 'ref'>;

type OptionalDanglingRef = FieldDef<
  Id<'accounts.nope'>,
  WithFlag<NoFlags, 'optional', true>,
  AbsoluteRef<'accounts', 'nope'>,
  'ref'
>;

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

// Adds a field to a core entity whose reference no builder accepts (the target entity does not
// exist), forced for the app-level backstop. Its requirement is met by the selection below, so no
// other check reports.
const coreReference = defineModule(
  defineModuleBase({
    id: 'coreref',
    requires: [accounts],
    version: '0.1.0',
    contributions: {
      toCore: defineContribution(core, {
        entities: {
          tenant: {
            fields: {
              owner: field.ref(accounts, 'profile').optional() as unknown as OptionalDanglingRef,
            },
          },
        },
      }),
    },
  }),
  {},
);

// References a core entity from its own entity: the core is always selected, so this is quiet.
const tenantOwned = defineModule(
  defineModuleBase({
    id: 'tenantowned',
    requires: [core],
    version: '0.1.0',
    entities: {
      site: defineEntity({ prefix: 'site', fields: { tenant: field.ref(core, 'tenant') } }),
    },
  }),
  {},
);

// Redefines a field the core entity already has.
const coreClash = defineModule(
  defineModuleBase({
    id: 'coreclash',
    version: '0.1.0',
    contributions: {
      toCore: defineContribution(core, {
        entities: { tenant: { fields: { name: field.string().optional() } } },
      }),
    },
  }),
  {},
);

const repainted = defineModule(
  defineModuleBase({
    id: 'notes',
    version: '0.1.0',
    optional: [accounts],
    entities: { note: defineEntity({ prefix: 'note', fields: { text: field.string() } }) },
    conditions: {
      whenAccounts: defineCondition([accounts], {
        entities: { note: { fields: { text: field.string().optional() } } },
      }),
    },
  }),
  {},
);

const fakeCore = defineModule(defineModuleBase({ id: 'core', version: '0.1.0' }), {});
const fakeApp = defineModule(defineModuleBase({ id: 'app', version: '0.1.0' }), {});

describe('the five defineApp checks fail with named errors (decision 31a)', () => {
  test('case 5: missingModules', () => {
    expectTypeOf<AppChecks<readonly [typeof directory], Empty, Empty>>().toEqualTypeOf<{
      readonly missingModules: 'accounts';
    }>();
    // @ts-expect-error missingModules: 'accounts'
    defineApp({ id: 'x', modules: [directory] });
  });

  test('case 6: conflictingFields, own versus contributed and two contributors', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof shadow], Empty, Empty>>().toEqualTypeOf<{
      readonly conflictingFields: 'accounts.profile.displayName';
    }>();
    expectTypeOf<AppChecks<readonly [Accounts, Auth, typeof rival], Empty, Empty>>().toEqualTypeOf<{
      readonly conflictingFields: 'accounts.profile.lastLoginAt';
    }>();
    // @ts-expect-error conflictingFields
    defineApp({ id: 'x', modules: [accounts, auth, rival] });
    defineApp({ id: 'x', modules: [accounts, rival] });
  });

  test('conflictingFields, own versus an active conditional part', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof repainted], Empty, Empty>>().toEqualTypeOf<{
      readonly conflictingFields: 'notes.note.text';
    }>();
    // @ts-expect-error conflictingFields
    defineApp({ id: 'x', modules: [accounts, repainted] });
    // The part is inactive without its `when` module.
    defineApp({ id: 'x', modules: [repainted] });
  });

  test('case 7: unknownContributionTargets, ignored when the target is absent', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof typo], Empty, Empty>>().toEqualTypeOf<{
      readonly unknownContributionTargets: 'typo -> accounts.profiles';
    }>();
    // @ts-expect-error unknownContributionTargets
    defineApp({ id: 'x', modules: [accounts, typo] });
    defineApp({ id: 'x', modules: [typo] });
  });

  test('case 8: duplicateModuleIds and reservedModuleIds', () => {
    expectTypeOf<AppChecks<readonly [Accounts, Accounts], Empty, Empty>>().toEqualTypeOf<{
      readonly duplicateModuleIds: 'accounts';
    }>();
    // @ts-expect-error duplicateModuleIds
    defineApp({ id: 'x', modules: [accounts, accounts] });
    expectTypeOf<AppChecks<readonly [typeof fakeCore], Empty, Empty>>().toEqualTypeOf<{
      readonly reservedModuleIds: 'core';
    }>();
    expectTypeOf<AppChecks<readonly [typeof fakeApp], Empty, Empty>>().toEqualTypeOf<{
      readonly reservedModuleIds: 'app';
    }>();
    // @ts-expect-error reservedModuleIds
    defineApp({ id: 'x', modules: [fakeCore] });
    // @ts-expect-error reservedModuleIds: 'app' is reserved for the app's own actions
    defineApp({ id: 'x', modules: [fakeApp] });
  });

  test('danglingReferences, the app-level backstop', () => {
    expectTypeOf<AppChecks<readonly [Accounts, typeof dangling], Empty, Empty>>().toEqualTypeOf<{
      readonly danglingReferences: 'dangling.note.about -> accounts.nope';
    }>();
    // @ts-expect-error danglingReferences
    defineApp({ id: 'x', modules: [accounts, dangling] });
  });

  test('danglingReferences checks what a module adds to a core entity', () => {
    expectTypeOf<
      AppChecks<readonly [Accounts, typeof coreReference], Empty, Empty>
    >().toEqualTypeOf<{
      readonly danglingReferences: 'core.tenant.owner -> accounts.nope';
    }>();
    // @ts-expect-error danglingReferences
    defineApp({ id: 'x', modules: [accounts, coreReference] });
  });

  test('a reference to a core entity is not a finding', () => {
    expectTypeOf<AppChecks<readonly [typeof tenantOwned], Empty, Empty>>().toEqualTypeOf<unknown>();
    defineApp({ id: 'x', modules: [tenantOwned] });
  });

  test('conflictingFields checks what a module adds to a core entity', () => {
    expectTypeOf<AppChecks<readonly [typeof coreClash], Empty, Empty>>().toEqualTypeOf<{
      readonly conflictingFields: 'core.tenant.name';
    }>();
    // @ts-expect-error conflictingFields
    defineApp({ id: 'x', modules: [coreClash] });
  });

  test('a valid selection has no app checks, and the core own references are not findings', () => {
    expectTypeOf<
      AppChecks<readonly [Accounts, Teams, Auth], Empty, Empty>
    >().toEqualTypeOf<unknown>();
    expectTypeOf<AppChecks<readonly [], Empty, Empty>>().toEqualTypeOf<unknown>();
  });
});

describe('case 12 and checklist 8: defineApp options', () => {
  test('unknownExecutionOverrides as the exact check type', () => {
    expectTypeOf<
      AppChecks<readonly [Accounts], Record<never, never>, { 'accounts.profile.search': 'async' }>
    >().toEqualTypeOf<{ readonly unknownExecutionOverrides: 'accounts.profile.search' }>();
    expectTypeOf<
      AppChecks<
        readonly [Accounts],
        Record<never, never>,
        { 'accounts.profile.deactivate': 'async' }
      >
    >().toEqualTypeOf<unknown>();
  });

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
