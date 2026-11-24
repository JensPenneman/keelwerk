import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { hasRole } from '../../lib/has-role.ts';

export const membersRead = defineRule(membersBase, membership, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'viewer', 'member', 'admin', 'owner'),
  reason: 'Every member sees who belongs to the tenant.',
});
