import { absentVerifier, defineCommand, errors, field, parseToken, shape } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';
import { membership } from '../../entities/membership.ts';
import { invitationInvalid } from '../../errors/invitation-invalid.ts';
import { invitationTokenPrefix } from '../../lib/invitation-token-prefix.ts';
import { memberRoles } from '../../lib/member-roles.ts';

/**
 * Accepts an invitation by its token: the signed-in person becomes a member with the invited
 * role. The token alone proves the right to accept (the address is not compared with the person's);
 * it works once. A token of another prefix, an unknown one, a wrong one, a used, withdrawn or
 * expired one all answer `members.invitation_invalid`, and an unknown token costs one verification
 * like a known one. Accepting moves the invitation to the person as its data subject and writes
 * the address again, so an erasure of the person reaches it.
 */
const acceptDef = defineCommand(membersBase, invitation, {
  creates: true,
  input: shape({ token: field.secret() }),
  output: shape({ membershipId: field.ref.own('membership'), role: field.enum(memberRoles) }),
  errors: [invitationInvalid],
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    const parsed = parseToken(input.token);
    const row =
      parsed === undefined || parsed.prefix !== invitationTokenPrefix
        ? undefined
        : yield* ctx.load.members.invitation.one({ where: { publicId: parsed.publicId } });
    const verified = yield* ctx.secrets.verify(input.token, row?.tokenVerifier ?? absentVerifier);
    const now = ctx.clock.now();
    if (
      !verified ||
      row === undefined ||
      row.status !== 'pending' ||
      Temporal.Instant.compare(row.expiresAt, now) <= 0
    ) {
      throw invitationInvalid();
    }
    const { subject } = ctx.principal;
    if (yield* ctx.load.members.membership.exists({ subject })) {
      throw errors.conflict('You are already a member of this tenant.');
    }
    if (row.role === 'owner' && (yield* ctx.load.members.membership.exists({ role: 'owner' }))) {
      throw errors.conflict('This tenant already has an owner.');
    }
    const membershipId = yield* ctx.newId(membership);
    return {
      events: [
        ctx.write.members.invitation.update(row, {
          status: 'accepted',
          acceptedAt: now,
          subject,
          email: row.email,
        }),
        ctx.write.members.membership.create({
          id: membershipId,
          subject,
          role: row.role,
          invitationId: row.id,
        }),
      ],
      result: { membershipId, role: row.role },
    };
  },
});

type AcceptPart = typeof acceptDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Accept extends AcceptPart {}
export const accept: Accept = acceptDef;
