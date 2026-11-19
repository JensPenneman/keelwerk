import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';

/** A transition: the inviter may move a pending invitation to withdrawn, and to nothing else. */
export const withdraw = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['update'],
  principal: 'user',
  where: (ctx) => ({ status: 'pending', invitedBy: ctx.principal.subject }) as const,
  check: () => ({ status: 'withdrawn' }) as const,
  fields: ['status'],
  reason: 'The person who invited withdraws a pending invitation.',
});
