import { defineCommand, field, shape } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { requireLiveAdmin } from '../../lib/require-live-admin.ts';
import { withdrawInvitationsOf } from '../../lib/withdraw-invitations-of.ts';

/**
 * Admins and the owner change a role, never to owner: the input cannot name it, and the owner row
 * itself is kept by `ownerKept`. The caller's membership is loaded, not read from the session, so a
 * session that outlives the caller's removal or demotion cannot grant a role. The same role is no
 * change. A demotion to member or viewer withdraws the invitations the person issued that are
 * still pending, in the same unit: only admins and the owner invite.
 */
const changeRoleDef = defineCommand(membersBase, membership, {
  input: shape({ role: field.enum(['admin', 'member', 'viewer']) }),
  principal: 'user',
  execution: 'sync',
  *decide(input, current, ctx) {
    yield* requireLiveAdmin(
      ctx,
      'Admins and the owner change the role of a member, but never to owner.',
    );
    if (current.role === input.role) return [];
    const withdrawn =
      input.role === 'admin' ? [] : yield* withdrawInvitationsOf(ctx, current.subject);
    return [ctx.write.members.membership.update(current, { role: input.role }), ...withdrawn];
  },
});

type ChangeRolePart = typeof changeRoleDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface ChangeRole extends ChangeRolePart {}
export const changeRole: ChangeRole = changeRoleDef;
