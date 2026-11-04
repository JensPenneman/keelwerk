import { describe, expectTypeOf, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { defineContribution } from '../dsl/define-contribution.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { field } from '../fields/field.ts';

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
