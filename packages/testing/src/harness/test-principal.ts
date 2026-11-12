/** Who a test calls as: a signed-in subject, or nobody (`subject: null`). Plain data, so a carrier can hold it. */
export interface TestPrincipal {
  readonly subject: string | null;
  readonly roles: readonly string[];
  readonly claims: Readonly<Record<string, unknown>>;
  /** The id the principal is stored and re-resolved by (a session's id); the subject when absent. */
  readonly principalId?: string;
}

/**
 * The principal of a test: `testPrincipal('ada')` is a user, `testPrincipal(null)` is anonymous.
 * `principalId` is the id a session of the subject stands under (the stored reference of its jobs and
 * receipts); it defaults to the subject.
 */
export function testPrincipal(
  subject: string | null,
  over: {
    readonly roles?: readonly string[];
    readonly claims?: Readonly<Record<string, unknown>>;
    readonly principalId?: string;
  } = {},
): TestPrincipal {
  return {
    subject,
    roles: over.roles ?? [],
    claims: over.claims ?? {},
    ...(over.principalId === undefined ? {} : { principalId: over.principalId }),
  };
}
