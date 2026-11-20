import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { hasRole } from '../../lib/has-role.ts';

/**
 * A transition: admins and the owner may move a pending invitation of the tenant to withdrawn, and
 * to nothing else, whoever issued it. Without it nobody could revoke the token of an invitation
 * another admin issued. The operator's owner invitation is out of reach (the call answers
 * `not_found`): an admin could otherwise withdraw it again and again and keep the tenant without
 * an owner.
 */
export const adminsWithdraw = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['update'],
  principal: 'user',
  where: (ctx) =>
    ({
      status: 'pending',
      role: { in: ['admin', 'member', 'viewer'] },
      // Anyone else matches no row, so the call answers `not_found`.
      ...(hasRole(ctx, 'admin', 'owner') ? {} : { id: { in: [] } }),
    }) as const,
  check: () => ({ status: 'withdrawn' }) as const,
  fields: ['status'],
  reason:
    'Admins and the owner withdraw a pending invitation of the tenant, but not an owner invitation.',
});
