/** One reset message as the test delivery filler received it. */
export interface DeliveredReset {
  readonly identifier: string;
  readonly token: string;
  readonly expiresAt: Temporal.Instant;
}

/** The messages the test delivery filler received, oldest first; a test empties it before it begins. */
export const delivered: DeliveredReset[] = [];
