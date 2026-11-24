import type { DecideContext, Draft, Gen, SubjectId } from '@keelwerk/core';
import type { MembersBase } from '../base.ts';

type Own = DecideContext<MembersBase>;

/**
 * Withdraws the pending invitations a person issued, in the unit that removes or demotes them. A
 * token issued before then stops working in any case (`accept` asks whether the inviter is still an
 * admin or the owner), but the pending row, and the address in it, must not wait for its expiry.
 * `settleEndedInvitation` ends each withdrawn row the same way a withdrawal does.
 */
export function* withdrawInvitationsOf(
  ctx: Pick<Own, 'load'> & { readonly write: { readonly members: Own['write']['members'] } },
  subject: SubjectId,
): Gen<readonly Draft[]> {
  const pending = yield* ctx.load.members.invitation.many({
    where: { invitedBy: subject, status: 'pending' },
  });
  return pending.map((row) => ctx.write.members.invitation.update(row, { status: 'withdrawn' }));
}
