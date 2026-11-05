import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { toAccounts } from '../../contribution.ts';

/** A user changes the password of their own profile. */
export const selfPassword = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['changePassword'],
  principal: 'user',
  where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }),
});
