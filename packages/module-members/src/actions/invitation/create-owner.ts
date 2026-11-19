import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { invitationOutput } from '../../lib/invitation-output.ts';
import { issueInvitation } from '../../lib/issue-invitation.ts';

/**
 * Brings up a tenant: an operator invites its first owner (17.5.4). A tenant that has an owner
 * refuses. A repeat withdraws the pending owner invitations and the pending invitation of the
 * address before it issues the new one, so one owner invitation is live at a time. The token is
 * shown once, as `invite` does.
 */
const createOwnerDef = defineCommand(membersBase, invitation, {
  creates: true,
  input: shape({ email: field.string({ format: 'email' }).personal() }),
  output: invitationOutput,
  shownOnce: ['token'],
  principal: 'operator',
  execution: 'sync',
  *decide(input, ctx) {
    if (yield* ctx.load.members.membership.exists({ role: 'owner' })) {
      throw errors.conflict('This tenant already has an owner.');
    }
    const earlier = yield* ctx.load.members.invitation.many({
      where: { role: 'owner', status: 'pending' },
    });
    const sameAddress = yield* ctx.load.members.invitation.one({
      where: { email: input.email, status: 'pending' },
    });
    const withdrawn = new Map(earlier.map((row) => [row.id, row]));
    if (sameAddress !== undefined) withdrawn.set(sameAddress.id, sameAddress);
    const issued = yield* issueInvitation(ctx, { email: input.email, role: 'owner' });
    return {
      events: [
        ...[...withdrawn.values()].map((row) =>
          ctx.write.members.invitation.update(row, { status: 'withdrawn' }),
        ),
        ...issued.events,
      ],
      effects: issued.effects,
      result: issued.result,
    };
  },
});

type CreateOwnerPart = typeof createOwnerDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface CreateOwner extends CreateOwnerPart {}
export const createOwner: CreateOwner = createOwnerDef;
