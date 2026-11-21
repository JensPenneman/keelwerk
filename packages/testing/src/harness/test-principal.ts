/** Who a test calls as: a signed-in subject, or nobody (`subject: null`). Plain data, so a carrier can hold it. */
export interface TestPrincipal {
  readonly subject: string | null;
  readonly roles: readonly string[];
  readonly claims: Readonly<Record<string, unknown>>;
  /** The id the principal is stored and re-resolved by (a session's id); the subject when absent. */
  readonly principalId?: string;
  /** When the principal's session ends, as an instant's text (a carrier holds plain data); absent: it never expires. */
  readonly expiresAt?: string;
}

/**
 * The principal of a test: `testPrincipal('ada')` is a user, `testPrincipal(null)` is anonymous.
 * `principalId` is the id a session of the subject stands under (the stored reference of its jobs and
 * receipts); it defaults to the subject. `expiresAt` makes the principal expire at that instant, as a
 * resolver's `Principal.expiresAt` does: the invoker opens no session for it at or after then.
 */
export function testPrincipal(
  subject: string | null,
  over: {
    readonly roles?: readonly string[];
    readonly claims?: Readonly<Record<string, unknown>>;
    readonly principalId?: string;
    readonly expiresAt?: Temporal.Instant;
  } = {},
): TestPrincipal {
  return {
    subject,
    roles: over.roles ?? [],
    claims: over.claims ?? {},
    ...(over.principalId === undefined ? {} : { principalId: over.principalId }),
    ...(over.expiresAt === undefined ? {} : { expiresAt: over.expiresAt.toString() }),
  };
}
