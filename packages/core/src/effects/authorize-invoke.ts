import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { forbiddenError } from '../authorization/forbidden-error.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { errors } from '../errors/errors.ts';
import { closedGateRefusal } from '../flags/closed-gate-refusal.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { checkServiceCaller } from './check-service-caller.ts';

/** What the gate of an invoked command reads. */
export interface AuthorizeInvokeInput {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly input: unknown;
  /** The invocation's flag snapshot; absent: declared defaults. */
  readonly flags?: FlagSnapshot | undefined;
  /** The module whose code invokes the command; only the code of M acts as `M.system` on M's actions. */
  readonly caller: string;
}

/**
 * The gate of a command another command or a reaction invokes (section 7.7): first the action's
 * flag gates (20.6), read from the snapshot of the invocation that returned the effect, which refuse
 * as the external path does; then a module's service principal is refused for an action of its own
 * module when another module's code invokes it (`checkServiceCaller`); the system principal of
 * `as: system(reason)` passes (the reason is logged by the caller), and any other principal needs
 * the rules, as at the pipeline's `authorize` stage; they include the core's default rule of each
 * module (section 7.7).
 */
export function authorizeInvoke(input: AuthorizeInvokeInput): void {
  const { action, principal } = input;
  // The gates close the action on every path, for the system and a module's own principal too.
  for (const stage of ['admit', 'authorize'] as const) {
    const closed = closedGateRefusal(input.registry, action, input.flags, stage);
    if (closed !== undefined) throw closed;
  }
  checkServiceCaller(principal, action, input.caller);
  if (principal.kind === 'system') return;
  const result = evaluateGate({
    rules: input.rules,
    action,
    context: principalContextOf(input.registry, principal, input.scope, input.flags),
    input: input.input,
  });
  if (result.allowed) return;
  if (principal.kind === 'anonymous' && action.auth !== 'public') {
    throw errors.unauthenticated('Sign in to do this.');
  }
  throw forbiddenError({ rules: result.rules, reason: result.reason, action: action.ref });
}
