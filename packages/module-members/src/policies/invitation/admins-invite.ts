import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { hasRole } from '../../lib/has-role.ts';

export const adminsInvite = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['invite'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'admin', 'owner'),
  reason: 'Admins and the owner invite people.',
});
