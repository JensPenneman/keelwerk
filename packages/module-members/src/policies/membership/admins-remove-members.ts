import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { hasRole } from '../../lib/has-role.ts';

export const adminsRemoveMembers = defineRule(membersBase, membership, {
  effect: 'allow',
  actions: ['removeMember'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'admin', 'owner'),
  reason: 'Admins and the owner remove a member.',
});
