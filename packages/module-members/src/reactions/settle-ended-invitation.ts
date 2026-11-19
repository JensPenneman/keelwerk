import { defineReaction, eraseOwnSubject, type Id } from '@keelwerk/core';
import { membersBase } from '../base.ts';

/**
 * Every end of an invitation (accepted, expired, withdrawn, retired) erases the invitation's id as a
 * subject in the same unit; an invitation that ends without accept loses its address (the lead's
 * answer on erasure and invitations). The key of the id seals the address the invitation was issued
 * with and every sealed copy of it in the change records, so once the erasure has run nothing of the
 * address opens under it. An accepted invitation keeps its address under the person it moved to.
 * The end is the change that sets the status to something other than pending: an invitation of a
 * `state` history carries no before-image, so the event's own change set says it. The reaction's
 * write of the dropped address sets no status, so it does nothing more.
 */
export const settleEndedInvitation = defineReaction(membersBase, {
  on: 'members.invitation.changed',
  timing: 'inline',
  *react(event, ctx) {
    const set = event.data.set as { readonly status?: string } | undefined;
    if (set?.status === undefined || set.status === 'pending') return [];
    const row = yield* ctx.load.members.invitation.byId(
      event.stream.id as Id<'members.invitation'>,
    );
    if (row === undefined || row.status === 'pending') return [];
    return {
      events:
        row.status === 'accepted' || row.email === undefined
          ? []
          : [ctx.write.members.invitation.update(row, { email: null })],
      effects: [eraseOwnSubject(event.stream)],
    };
  },
});
