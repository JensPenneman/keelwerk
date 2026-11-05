import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { toAccounts } from '../../contribution.ts';

/** A user reads their own profile, including the maskable fields (17.2.1). */
export const self = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }),
  fields: ['email', 'lastLoginAt'],
});
