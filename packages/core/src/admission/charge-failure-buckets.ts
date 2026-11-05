import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { Outcome } from '../invoker/outcome.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ModuleCharge } from './module-charge.ts';
import { takeCharges } from './take-charges.ts';

/**
 * The `onDeclaredError` buckets of the rules (section 12.2), taken in a short unit of the
 * invocation's scope after the outcome, so a failed attempt counts although its own unit rolled
 * back. Only a failure with an error the action declares is charged. Taking never changes the
 * outcome: a store that cannot be reached is logged and the answer stands.
 */
export async function chargeFailureBuckets(
  env: InvokerEnv,
  input: {
    readonly action: ActionEntry;
    readonly target: ScopeTarget;
    readonly charges: readonly ModuleCharge[];
    readonly outcome: Outcome<unknown>;
  },
): Promise<void> {
  const { action, target, charges, outcome } = input;
  if (outcome.ok || charges.length === 0 || !action.errors.includes(outcome.error.code)) return;
  try {
    await takeCharges(target, env.options.keys, charges);
  } catch (error) {
    env.options.log.warn('failure buckets could not be charged', {
      action: action.ref,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
