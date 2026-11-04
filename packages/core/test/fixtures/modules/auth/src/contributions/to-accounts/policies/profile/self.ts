import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { toAccounts } from '../../contribution.ts';

export const self = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ credentials: { some: { subject: ctx.principal.subject } } }),
  fields: ['email', 'lastLoginAt'],
});
