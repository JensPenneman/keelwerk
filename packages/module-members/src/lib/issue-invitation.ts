import {
  type Draft,
  type EffectDraft,
  type Gen,
  type Id,
  type SubjectId,
  setTimer,
} from '@keelwerk/core';
import { expireInvitation } from '../actions/expire-invitation.ts';
import { invitation } from '../entities/invitation.ts';
import type { InvitationContext } from './invitation-context.ts';
import { invitationLifetimeDays } from './invitation-lifetime-days.ts';
import { invitationTokenPrefix } from './invitation-token-prefix.ts';
import type { MemberRole } from './member-roles.ts';

/** An invitation as issued: its events and effects, and what the command answers. */
export interface IssuedInvitation {
  readonly events: readonly Draft[];
  readonly effects: readonly EffectDraft[];
  readonly result: {
    readonly id: Id<'members.invitation'>;
    readonly token?: string;
    readonly expiresAt: Temporal.Instant;
  };
}

/**
 * Creates a pending invitation, sets the keyed timer that expires it and hands the address, the
 * accept token and the role to every delivery filler. The token is in the result only when no
 * filler took it (decision 480). It checks nothing about other invitations: callers do.
 */
export function* issueInvitation(
  ctx: InvitationContext,
  request: {
    readonly email: string;
    readonly role: MemberRole;
    readonly invitedBy?: SubjectId;
  },
): Gen<IssuedInvitation> {
  const id = yield* ctx.newId(invitation);
  const issued = yield* ctx.secrets.issue({ prefix: invitationTokenPrefix });
  const expiresAt = ctx.clock.now().add({ hours: invitationLifetimeDays * 24 });
  const effects: EffectDraft[] = [
    setTimer({
      key: `expire:${id}`,
      invoke: expireInvitation,
      input: { invitationId: id },
      at: expiresAt,
    }),
  ];
  const fills = ctx.extensions.invitationDelivery;
  for (const delivery of fills) {
    effects.push(
      ...(yield* delivery.deliver({
        email: request.email,
        token: issued.plain,
        role: request.role,
        expiresAt,
      })),
    );
  }
  return {
    events: [
      ctx.write.members.invitation.create({
        id,
        // An erasable subject of its own while pending; accept moves it to the person.
        subject: id as unknown as SubjectId,
        email: request.email,
        role: request.role,
        status: 'pending',
        ...(request.invitedBy === undefined ? {} : { invitedBy: request.invitedBy }),
        publicId: issued.publicId,
        tokenVerifier: issued.verifier,
        expiresAt,
      }),
    ],
    effects,
    result: { id, ...(fills.length === 0 ? { token: issued.plain } : {}), expiresAt },
  };
}
