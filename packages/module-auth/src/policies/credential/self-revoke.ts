import { defineRule } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';

export const selfRevoke = defineRule(authBase, credential, {
  effect: 'allow',
  actions: ['revoke'],
  principal: 'user',
  where: (ctx) => ({ subject: ctx.principal.subject }),
});
