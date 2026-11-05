import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { toAccounts } from '../../contribution.ts';

/** A user changes the display name and the locale of their own profile. */
export const selfEdit = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['update'],
  principal: 'user',
  where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }),
  fields: ['displayName', 'locale'],
});
