import { defineRule } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';

export const self = defineRule(authBase, credential, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ subject: ctx.principal.subject }),
  fields: ['lastUsedAt'],
  reason: 'A user sees their own credentials.',
});
