import type { AnyEffect } from '../protocol/any-effect.ts';
import type { Scope } from '../storage/scope.ts';
import { deriveEffectId } from './derive-effect-id.ts';

/**
 * The ids of the deferred effects a decision's effects request, in order: those of its external
 * effects, derived from the scope, the cause and the effect's index among all of the decision's
 * effects. The decision record lists them before the effects are performed.
 */
export function plannedEffectIds(
  scope: Scope,
  cause: string,
  effects: readonly AnyEffect[],
): readonly string[] {
  return effects.flatMap((effect, index) =>
    effect.kind === 'external' ? [deriveEffectId(scope, cause, index)] : [],
  );
}
