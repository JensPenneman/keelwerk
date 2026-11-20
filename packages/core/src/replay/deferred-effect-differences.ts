import { plannedEffectIds } from '../effects/planned-effect-ids.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { effectRequestDifference } from './effect-request-difference.ts';
import { effectRowOf } from './effect-row-of.ts';

/**
 * One line for every deferred effect a re-decided decision requests that is not the effect the
 * `requested` record of its `core.effect` stream holds: another type, input, continuation or key,
 * or no record; and the counts of the effects recorded and re-decided when they differ. The ids are positional, so an id the record lists does not show a changed request.
 */
export async function deferredEffectDifferences(input: {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly scope: Scope;
  readonly commandId: string;
  readonly effects: readonly AnyEffect[];
  readonly recorded: readonly string[];
  readonly personalByPresence?: true;
}): Promise<readonly string[]> {
  const { unit, registry, recorded } = input;
  const ids = plannedEffectIds(input.scope, input.commandId, input.effects);
  const externals = input.effects.filter((effect) => effect.kind === 'external');
  const differences: string[] = [];
  if (input.effects.length !== recorded.length) {
    differences.push(
      `${recorded.length} effects were recorded and ${input.effects.length} were re-decided`,
    );
  }
  for (const [index, effect] of externals.entries()) {
    const effectId = ids[index];
    // An id the record lacks is reported with the decision record's effects.
    if (effectId === undefined || !recorded.includes(effectId)) continue;
    const row = await effectRowOf(unit, registry, effectId);
    if (row === undefined) {
      differences.push(`the effect ${effectId} has no record`);
      continue;
    }
    const difference = await effectRequestDifference({
      unit,
      registry,
      effectId,
      effect,
      row,
      deferred: true,
      ...(input.personalByPresence === true ? { personalByPresence: true } : {}),
    });
    if (difference !== undefined) differences.push(difference);
  }
  return differences;
}
