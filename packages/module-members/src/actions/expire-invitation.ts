import { defineCommand, field, setTimer, shape } from '@keelwerk/core';
import { membersBase } from '../base.ts';

/**
 * Marks a pending invitation expired once its time has come. The timer that `issueInvitation` sets
 * runs it as the module's own service principal; `settleEndedInvitation` then drops the address and
 * erases the invitation's id as a subject. It is idempotent: an invitation that is gone or no
 * longer pending changes nothing, because `accept` checks the expiry itself and this only settles
 * the stored status. A pending invitation that is not due yet (the node that decides runs a few
 * milliseconds behind the one that fired the timer) sets the same keyed timer again at its expiry,
 * so it still ends.
 */
const expireInvitationDef = defineCommand(membersBase, {
  input: shape({ invitationId: field.ref.own('invitation') }),
  principal: 'service',
  execution: 'sync',
  *decide(input, ctx) {
    const row = yield* ctx.load.members.invitation.byId(input.invitationId);
    if (row === undefined || row.status !== 'pending') return [];
    if (Temporal.Instant.compare(row.expiresAt, ctx.clock.now()) > 0) {
      return {
        effects: [
          setTimer({
            key: `expire:${row.id}`,
            invoke: 'members.expireInvitation',
            input: { invitationId: row.id },
            at: row.expiresAt,
          }),
        ],
      };
    }
    return [ctx.write.members.invitation.update(row, { status: 'expired' })];
  },
});

type ExpireInvitationPart = typeof expireInvitationDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface ExpireInvitation extends ExpireInvitationPart {}
export const expireInvitation: ExpireInvitation = expireInvitationDef;
