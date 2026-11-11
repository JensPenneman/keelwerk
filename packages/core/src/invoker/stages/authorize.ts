import { evaluateGate } from '../../authorization/evaluate-gate.ts';
import { forbiddenError } from '../../authorization/forbidden-error.ts';
import type { NormalizedRule } from '../../authorization/normalized-rule.ts';
import { errors } from '../../errors/errors.ts';
import type { RuleMatch } from '../../errors/rule-match.ts';
import { closedGateRefusal } from '../../flags/closed-gate-refusal.ts';
import type { FlagSnapshot } from '../../flags/flag-snapshot.ts';
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
  /** The invocation's flag snapshot; absent: declared defaults. */
  readonly flags?: FlagSnapshot | undefined;
}): readonly RuleMatch[] {
  const { action, session } = input;
  // The gates come first (20.6): a closed one is a deny rule named after the gate.
  const closed = closedGateRefusal(input.registry, action, input.flags, 'authorize');
  if (closed !== undefined) throw closed;
  const result = evaluateGate({
    rules: input.rules,
    action,
    context: principalContextOf(input.registry, session.principal, session.scope, input.flags),
    transport: input.transport,
    input: input.value,
  });
  if (result.allowed) return result.rules;
  if (session.principal.kind === 'anonymous' && action.auth !== 'public') {
    throw errors.unauthenticated('Sign in to do this.');
  }
  throw forbiddenError({ rules: result.rules, reason: result.reason, action: action.ref });
}
