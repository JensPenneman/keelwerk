import type { EffectDraft, Gen } from '@keelwerk/core';
import { extensionPoint } from '@keelwerk/core';
import type { MemberRole } from '../lib/member-roles.ts';

/** What a delivery filler is handed for one invitation. */
interface InvitationMessage {
  readonly email: string;
  /**
   * The accept token, shown to the delivery only. It is a secret: a filler must not put it into a
   * plain effect input.
   */
  readonly token: string;
  readonly role: MemberRole;
  readonly expiresAt: Temporal.Instant;
}

/** The contract of the extension point members declares for the platform that delivers invitations. */
export interface InvitationDelivery {
  readonly id: string;
  /** A pure generator bound to its contributor's context; the effects it returns join the invitation's decision. */
  deliver(message: InvitationMessage): Gen<readonly EffectDraft[]>;
}

export const invitationDelivery = extensionPoint.set<InvitationDelivery>();
