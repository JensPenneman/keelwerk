import { defineRule } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const directory = defineRule(accountsBase, profile, {
  effect: 'allow',
  actions: ['read', 'search'],
  where: (ctx) => ctx.principal.roles.includes('directory'),
  fields: [],
});
