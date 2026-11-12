import { defineRule } from '@keelwerk/core';
import { apiKeysBase } from '../../base.ts';
import { key } from '../../entities/key.ts';

export const own = defineRule(apiKeysBase, key, {
  effect: 'allow',
  actions: ['read', 'revoke'],
  principal: 'user',
  where: (ctx) => ({ subject: ctx.principal.subject }),
  reason: 'A person sees and revokes their own keys.',
});
