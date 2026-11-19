import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { hasRole } from '../../lib/has-role.ts';

/** Admins and the owner change a role, never to owner and never the owner's own: `check` judges the row produced. */
export const changeRole = defineRule(membersBase, membership, {
  effect: 'allow',
  actions: ['update'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'admin', 'owner'),
  check: () => ({ role: { ne: 'owner' } }) as const,
  fields: ['role'],
  reason: 'Admins and the owner change the role of a member, but never to owner.',
});
