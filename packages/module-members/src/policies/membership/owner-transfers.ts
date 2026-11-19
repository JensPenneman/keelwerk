import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { hasRole } from '../../lib/has-role.ts';

export const ownerTransfers = defineRule(membersBase, membership, {
  effect: 'allow',
  actions: ['transferOwnership'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'owner'),
  reason: 'Only the owner moves ownership.',
});
