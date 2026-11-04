import { describe, expectTypeOf, test } from 'vitest';
import type { IdentityProvider } from '../../test/fixtures/modules/accounts/src/extension-points/identity-provider.ts';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { field } from '../fields/field.ts';
import { contracts } from './contracts.ts';
import { defineCommand } from './define-command.ts';
import { defineCondition } from './define-condition.ts';
import { defineContribution } from './define-contribution.ts';
import { defineEntity } from './define-entity.ts';
import { defineModuleBase } from './define-module-base.ts';
import { extensionPoint } from './extension-point.ts';

describe('the base checks of defineModuleBase (cases 9 and 10, decision 98)', () => {
  test('refsOutsideRequirements: a reference to an optional module fails; to a required one it is accepted', () => {
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

  test('contributedFieldsNeedDefault and contributionsOutsideDependencies', () => {
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

  test("unknownConditionTargets: a conditional part patches only the module's own entities", () => {
    defineModuleBase({
      id: 'notes',
      version: '0.1.0',
      optional: [accounts],
      entities: { note: defineEntity({ prefix: 'note', fields: { text: field.string() } }) },
      conditions: {
        whenAccounts: defineCondition([accounts], {
          entities: { note: { fields: { author: field.string().optional() } } },
        }),
      },
    });
    // @ts-expect-error unknownConditionTargets: notes has no entity 'memo'
    defineModuleBase({
      id: 'notes',
      version: '0.1.0',
      optional: [accounts],
      entities: { note: defineEntity({ prefix: 'note', fields: { text: field.string() } }) },
      conditions: {
        whenAccounts: defineCondition([accounts], {
          entities: { memo: { fields: { author: field.string().optional() } } },
        }),
      },
    });
  });

  test('unknownContributionTargets at defineContribution (section 5.3)', () => {
    defineContribution(accounts, {
      entities: { profile: { fields: { note: field.string().optional() } } },
    });
    // @ts-expect-error unknownContributionTargets: accounts has no entity 'profiles'
    defineContribution(accounts, {
      entities: { profiles: { fields: { note: field.string().optional() } } },
    });
  });

  test('nested calls keep their literal types: an inline contribution with when is active (decision 100)', () => {
    const base = defineModuleBase({
      id: 'nested',
      version: '0.1.0',
      optional: [accounts, teams],
      contributions: {
        toAccounts: defineContribution(accounts, {
          when: [teams],
          entities: { profile: { fields: { team: field.string().optional() } } },
        }),
      },
      conditions: { whenTeams: defineCondition([teams], {}) },
    });
    expectTypeOf(base.contributions.toAccounts.when).toEqualTypeOf<readonly [typeof teams]>();
    expectTypeOf(base.conditions.whenTeams.when).toEqualTypeOf<readonly [typeof teams]>();
    const inlineEntity = defineModuleBase({
      id: 'inline',
      version: '0.1.0',
      entities: { item: defineEntity({ prefix: 'item', fields: { name: field.string() } }) },
    });
    expectTypeOf(inlineEntity.entities.item.history).toEqualTypeOf<'chain'>();
  });

  test('contracts: defineContract takes no type argument, extension points carry their mode (decisions 95 and 96)', () => {
    expectTypeOf(contracts.live).toEqualTypeOf<{
      readonly kind: 'contract';
      readonly contract: 'live';
      readonly level: 'app';
    }>();
    expectTypeOf(extensionPoint.single<IdentityProvider>().mode).toEqualTypeOf<'single'>();
    expectTypeOf(extensionPoint.set<IdentityProvider>().mode).toEqualTypeOf<'set'>();
    expectTypeOf(extensionPoint.ordered<IdentityProvider>().mode).toEqualTypeOf<'ordered'>();
    const single = defineModuleBase({
      id: 'single-point',
      version: '0.1.0',
      extensionPoints: {
        one: extensionPoint.single<IdentityProvider>(),
        many: extensionPoint.set<IdentityProvider>(),
      },
    });
    const part = defineCommand(single, {
      decide: (_input, ctx) => {
        expectTypeOf(ctx.extensions.one).toEqualTypeOf<IdentityProvider>();
        expectTypeOf(ctx.extensions.many).toEqualTypeOf<readonly IdentityProvider[]>();
        return [];
      },
    });
    expectTypeOf(part.kind).toEqualTypeOf<'command'>();
  });
});
