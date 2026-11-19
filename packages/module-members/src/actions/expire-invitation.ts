import { defineCommand, field, shape } from '@keelwerk/core';
import { membersBase } from '../base.ts';

/**
 * Marks a pending invitation expired once its time has come. The timer that `issueInvitation` sets
 * runs it as the module's own service principal. It is idempotent: an invitation that is gone, no
 * longer pending or not yet due changes nothing, because `accept` checks the expiry itself and this
 * only settles the stored status.
 */
const expireInvitationDef = defineCommand(membersBase, {
  input: shape({ invitationId: field.ref.own('invitation') }),
  principal: 'service',
  execution: 'sync',
  *decide(input, ctx) {
    const row = yield* ctx.load.members.invitation.byId(input.invitationId);
    if (
      row === undefined ||
      row.status !== 'pending' ||
      Temporal.Instant.compare(row.expiresAt, ctx.clock.now()) > 0
    ) {
      return [];
    }
    return [ctx.write.members.invitation.update(row, { status: 'expired' })];
  },
});

type ExpireInvitationPart = typeof expireInvitationDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface ExpireInvitation extends ExpireInvitationPart {}
export const expireInvitation: ExpireInvitation = expireInvitationDef;
