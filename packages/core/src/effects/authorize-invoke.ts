import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { forbiddenError } from '../authorization/forbidden-error.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { errors } from '../errors/errors.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { Principal } from '../principals/principal.ts';
import { isOwnModuleAction } from '../reactions/is-own-module-action.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';

/** What the gate of an invoked command reads. */
export interface AuthorizeInvokeInput {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly action: ActionEntry;
  readonly principal: Principal;
  readonly scope: Scope;
  readonly input: unknown;
}

/**
 * The gate of a command another command or a reaction invokes (section 7.7): the system principal
 * of `as: system(reason)` passes (the reason is logged by the caller), a module's service
 * principal passes for the actions of its own module (the core's default rule), and any other
 * principal needs the rules, as at the pipeline's `authorize` stage.
 */
export function authorizeInvoke(input: AuthorizeInvokeInput): void {
  const { action, principal } = input;
  if (principal.kind === 'system' || isOwnModuleAction(principal, action)) return;
  const result = evaluateGate({
    rules: input.rules,
    action,
    context: principalContextOf(input.registry, principal, input.scope),
    input: input.input,
  });
  if (result.allowed) return;
  if (principal.kind === 'anonymous' && action.auth !== 'public') {
    throw errors.unauthenticated('Sign in to do this.');
  }
  throw forbiddenError({ rules: result.rules, reason: result.reason, action: action.ref });
}
