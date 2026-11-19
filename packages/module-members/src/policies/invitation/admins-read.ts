import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { hasRole } from '../../lib/has-role.ts';

export const adminsRead = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'admin', 'owner'),
  reason: 'Admins and the owner see the invitations of the tenant.',
});
