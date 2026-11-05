import { defineRule } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { session } from '../../entities/session.ts';

export const selfSessions = defineRule(authBase, session, {
  effect: 'allow',
  actions: ['read', 'revoke'],
  principal: 'user',
  where: (ctx) => ({ subject: ctx.principal.subject }),
});
