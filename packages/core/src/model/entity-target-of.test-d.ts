import { describe, expectTypeOf, test } from 'vitest';
import { authBase } from '../../test/fixtures/modules/auth/src/base.ts';
import { whenAccounts } from '../../test/fixtures/modules/auth/src/conditional/when-accounts/condition.ts';
import { toAccounts } from '../../test/fixtures/modules/auth/src/contributions/to-accounts/contribution.ts';
import { defineRule } from '../dsl/define-rule.ts';
import { within } from '../dsl/within.ts';
import type { EntityTargetOf } from './entity-target-of.ts';

const contribution = within(authBase, toAccounts);
const condition = within(authBase, whenAccounts);

describe('entity targets of a part source', () => {
  test('a contribution source names the target module entities', () => {
    defineRule(within(authBase, toAccounts), 'profile', { effect: 'allow', public: true });
    // @ts-expect-error the accounts module has no entity named nope
    defineRule(within(authBase, toAccounts), 'nope', { effect: 'allow', public: true });
    expectTypeOf<'profile'>().toExtend<EntityTargetOf<typeof contribution>>();
    expectTypeOf<EntityTargetOf<typeof condition>>().not.toEqualTypeOf<string>();
  });

  test('a conditional source has no contribution target, so no string names an entity', () => {
    // @ts-expect-error a condition has no contribution target; the name branch is never, not string
    defineRule(within(authBase, whenAccounts), 'profile', { effect: 'allow', public: true });
  });
});
