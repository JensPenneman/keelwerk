import { isKeelwerkError } from '@keelwerk/core';
import { expect } from 'vitest';

/**
 * Asserts that a call was refused by the policy: it rejects with a `forbidden` or `unauthenticated`
 * error and, when `ruleId` is given, that rule is among the rules the error names (the deciding deny
 * rule, or a rule that would have had to allow).
 */
export async function expectDenied(call: Promise<unknown>, ruleId?: string): Promise<void> {
  const error = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error, 'the call was allowed').toBeDefined();
  expect(isKeelwerkError(error), `the call failed with ${String(error)}`).toBe(true);
  if (!isKeelwerkError(error)) return;
  expect(['forbidden', 'unauthenticated']).toContain(error.kind);
  if (ruleId !== undefined) {
    expect(
      (error.rules ?? []).map((rule) => rule.id),
      `the rules ${JSON.stringify(error.rules ?? [])} do not include ${ruleId}`,
    ).toContain(ruleId);
  }
}
