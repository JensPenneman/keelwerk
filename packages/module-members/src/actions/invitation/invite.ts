import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { invitationOutput } from '../../lib/invitation-output.ts';
import { issueInvitation } from '../../lib/issue-invitation.ts';
import { requireLiveAdmin } from '../../lib/require-live-admin.ts';

/**
 * Invites a person by address to hold a role in this tenant. The address is sealed and found by
 * its keyed digest. The accept token is shown once and only when no delivery filler took it
 * (decision 480); the receipt never keeps it. An address that already has a pending invitation is
 * refused without naming it, until that invitation is withdrawn or has expired. The caller's
 * membership is loaded, not read from the session, so a removed admin whose session is still open
 * issues no token. Only `createOwner` and `transferOwnership` give the owner role.
 */
const inviteDef = defineCommand(membersBase, invitation, {
  creates: true,
  input: shape({
    email: field.string({ format: 'email' }).personal(),
    role: field.enum(['admin', 'member', 'viewer']),
  }),
  output: invitationOutput,
  shownOnce: ['token'],
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    // First, before any address is read: a removed admin whose session is still open learns nothing.
    yield* requireLiveAdmin(ctx, 'Admins and the owner invite people.');
    const now = ctx.clock.now();
    const pending = yield* ctx.load.members.invitation.one({
      where: { email: input.email, status: 'pending' },
    });
    const retired = [];
    if (pending !== undefined) {
      if (Temporal.Instant.compare(pending.expiresAt, now) > 0) {
        throw errors.conflict('This address has a pending invitation; withdraw it first.');
      }
      retired.push(ctx.write.members.invitation.update(pending, { status: 'expired' }));
    }
    const issued = yield* issueInvitation(ctx, {
      email: input.email,
      role: input.role,
      invitedBy: ctx.principal.subject,
    });
    return {
      events: [...retired, ...issued.events],
      effects: issued.effects,
      result: issued.result,
    };
  },
});

type InvitePart = typeof inviteDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Invite extends InvitePart {}
export const invite: Invite = inviteDef;
