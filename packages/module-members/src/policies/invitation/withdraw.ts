import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { hasRole } from '../../lib/has-role.ts';

/**
 * A transition: the inviter may move a pending invitation to withdrawn, and to nothing else, while
 * the inviter still holds a membership of the tenant. A person who was removed keeps no power over
 * the tenant's invitations: the call answers `not_found`.
 */
export const withdraw = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['update'],
  principal: 'user',
  where: (ctx) =>
    ({
      status: 'pending',
      invitedBy: ctx.principal.subject,
      // A person with no membership matches no row, so the call answers `not_found`, as another admin's does.
      ...(hasRole(ctx, 'viewer', 'member', 'admin', 'owner') ? {} : { id: { in: [] } }),
    }) as const,
  check: () => ({ status: 'withdrawn' }) as const,
  fields: ['status'],
  reason: 'The person who invited withdraws a pending invitation while a member.',
});
