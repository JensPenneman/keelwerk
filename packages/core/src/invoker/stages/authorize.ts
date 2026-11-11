import { evaluateGate } from '../../authorization/evaluate-gate.ts';
import { forbiddenError } from '../../authorization/forbidden-error.ts';
import type { NormalizedRule } from '../../authorization/normalized-rule.ts';
import { errors } from '../../errors/errors.ts';
import type { RuleMatch } from '../../errors/rule-match.ts';
import { principalContextOf } from '../../interpreter/principal-context-of.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import type { InvocationSession } from '../invocation-session.ts';

/**
 * `authorize` (section 9.2): the gate of section 8.4 over the session's principal and scope.
 * Answers the allow rules in effect. A denial is `forbidden` with the rule ids, except that an anonymous caller of a non-public
 * action is `unauthenticated`, so a client knows to sign in.
 */
export function authorize(input: {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly session: InvocationSession;
  readonly transport: string | null;
  /** The validated input, for `when`. */
  readonly value: unknown;
}): readonly RuleMatch[] {
  const { action, session } = input;
  const result = evaluateGate({
    rules: input.rules,
    action,
    context: principalContextOf(input.registry, session.principal, session.scope),
    transport: input.transport,
    input: input.value,
  });
  if (result.allowed) return result.rules;
  if (session.principal.kind === 'anonymous' && action.auth !== 'public') {
    throw errors.unauthenticated('Sign in to do this.');
  }
  throw forbiddenError({ rules: result.rules, reason: result.reason, action: action.ref });
}
