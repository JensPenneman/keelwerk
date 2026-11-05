import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { toAccounts } from '../../contribution.ts';

/** A profile whose credential the caller shares is readable by that caller (the relation auth contributed). */
export const sharedCredential = defineRule(within(authBase, toAccounts), 'profile', {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ credentials: { some: { subject: ctx.principal.subject } } }),
});
