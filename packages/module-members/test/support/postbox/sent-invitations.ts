/** One invitation message as the test delivery filler received it. */
export interface SentInvitation {
  readonly email: string;
  readonly token: string;
  readonly role: string;
  readonly expiresAt: Temporal.Instant;
}

/** The messages the test delivery filler received, oldest first; a test empties it before it begins. */
export const sentInvitations: SentInvitation[] = [];
