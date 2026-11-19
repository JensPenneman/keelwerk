import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { hasRole } from '../../lib/has-role.ts';

export const adminsChangeRoles = defineRule(membersBase, membership, {
  effect: 'allow',
  actions: ['changeRole'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'admin', 'owner'),
  reason: 'Admins and the owner change the role of a member, but never to owner.',
});
