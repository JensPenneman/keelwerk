import { defineCommand } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';
import { requireLiveAdmin } from '../../lib/require-live-admin.ts';
import { withdrawInvitationsOf } from '../../lib/withdraw-invitations-of.ts';

/**
 * Admins and the owner remove a member (the row is archived; the owner row is kept by
 * `ownerKept`). The caller's membership is loaded, not read from the session, so a session that
 * outlives the caller's removal or demotion cannot remove anyone. The invitations the removed
 * person issued and that are still pending are withdrawn in the same unit.
 */
const removeMemberDef = defineCommand(membersBase, membership, {
  principal: 'user',
  execution: 'sync',
  *decide(_input, current, ctx) {
    yield* requireLiveAdmin(ctx, 'Admins and the owner remove a member.');
    const withdrawn = yield* withdrawInvitationsOf(ctx, current.subject);
    return [ctx.write.members.membership.archive(current), ...withdrawn];
  },
});

type RemoveMemberPart = typeof removeMemberDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RemoveMember extends RemoveMemberPart {}
export const removeMember: RemoveMember = removeMemberDef;
