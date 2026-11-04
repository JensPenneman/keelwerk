/** Who a test calls as: a signed-in subject, or nobody (`subject: null`). Plain data, so a carrier can hold it. */
export interface TestPrincipal {
  readonly subject: string | null;
  readonly roles: readonly string[];
  readonly claims: Readonly<Record<string, unknown>>;
}

/** The principal of a test: `testPrincipal('ada')` is a user, `testPrincipal(null)` is anonymous. */
export function testPrincipal(
  subject: string | null,
  over: {
    readonly roles?: readonly string[];
    readonly claims?: Readonly<Record<string, unknown>>;
  } = {},
): TestPrincipal {
  return { subject, roles: over.roles ?? [], claims: over.claims ?? {} };
}
