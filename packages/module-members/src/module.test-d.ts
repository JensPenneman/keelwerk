import { defineApp, type Id } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import type { ExpectValidApp, HasAction, HasEntity } from '@keelwerk/testing/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Invite } from './actions/invitation/invite.ts';
import { hasRole } from './lib/has-role.ts';
import { type Members, members } from './module.generated.ts';

describe('the members manifest', () => {
  test('is the module members', () => {
    expectTypeOf<Members['id']>().toEqualTypeOf<'members'>();
  });

  test('members alone and beside accounts and auth', () => {
    const alone = defineApp({ id: 'alone', modules: [members] as const });
    expectTypeOf<ExpectValidApp<typeof alone>>().toEqualTypeOf<true>();
    expectTypeOf<
      HasEntity<typeof alone, 'members.invitation' | 'members.membership'>
    >().toEqualTypeOf<true>();
    expectTypeOf<
      HasAction<
        typeof alone,
        | 'members.expireInvitation'
        | 'members.invitation.invite'
        | 'members.invitation.createOwner'
        | 'members.invitation.accept'
        | 'members.membership.transferOwnership'
        | 'members.invitation.update'
        | 'members.membership.archive'
      >
    >().toEqualTypeOf<true>();
    const beside = defineApp({ id: 'beside', modules: [accounts, auth, members] as const });
    expectTypeOf<ExpectValidApp<typeof beside>>().toEqualTypeOf<true>();
  });

  test('invite answers an optional token beside the id', () => {
    type Output = NonNullable<Invite['~types']>['output'];
    expectTypeOf<Output['id']>().toEqualTypeOf<Id<'members.invitation'>>();
    expectTypeOf<Output['token']>().toEqualTypeOf<string | undefined>();
  });

  test('hasRole takes member roles only', () => {
    expectTypeOf(hasRole).parameter(1).toEqualTypeOf<'owner' | 'admin' | 'member' | 'viewer'>();
    // @ts-expect-error a role of the member roles only
    hasRole({} as never, 'root');
  });
});
