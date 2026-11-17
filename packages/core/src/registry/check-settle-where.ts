import { sealedWhereMember } from '../effects/sealed-where-member.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { probeContext } from './probe-context.ts';
import type { Registry } from './registry.ts';

/** The settle drafts a decision's result lists, or none for any other result. */
function settlesOf(result: unknown): readonly { effectType?: unknown; where?: unknown }[] {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return [];
  const effects: unknown = Reflect.get(result, 'effects');
  if (!Array.isArray(effects)) return [];
  return effects.filter(
    (effect): effect is { effectType?: unknown; where?: unknown } =>
      typeof effect === 'object' && effect !== null && Reflect.get(effect, 'kind') === 'settle',
  );
}

/**
 * `settleSealedFilter` (error): runs each command's decide (kind 'command', not generated) once with
 * `probeContext()` as input and context; a returned `{ effects }` holding a settle draft whose
 * `where` names a member `sealedWhereMember` finds is a problem. Throws, generators and any other
 * result are skipped; a `where` the probe does not reach is refused at the settle (`internal`).
 */
export function checkSettleWhere(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const action of registry.actions.values()) {
    if (action.kind !== 'command' || action.generated !== undefined) continue;
    let result: unknown;
    try {
      result = action.handler(probeContext(), probeContext(), probeContext());
    } catch {
      // A decide that cannot run on a probe is outside what this check can see.
      continue;
    }
    for (const draft of settlesOf(result)) {
      if (draft.where === undefined || typeof draft.effectType !== 'string') continue;
      const entry = registry.effects.get(draft.effectType);
      if (entry === undefined) continue;
      const member = sealedWhereMember(entry, draft.where);
      if (member === undefined) continue;
      problems.push(
        compositionError(
          'settleSealedFilter',
          `"${action.ref}" settles "${entry.ref}" filtered by "${member}", which is no plaintext member of its input.`,
          { module: action.module, ref: action.ref },
        ),
      );
    }
  }
  return problems;
}
