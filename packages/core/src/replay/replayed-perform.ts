import { inlineEffectId } from '../effects/inline-effect-id.ts';
import type { RequestAnswerer } from '../kernel/request-answerer.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { inlineAnswerOf } from '../write-path/inline-answer-of.ts';
import { effectRequestDifference } from './effect-request-difference.ts';
import { effectRowOf } from './effect-row-of.ts';
import { replayMismatch } from './replay-mismatch.ts';
import { replayUnsupported } from './replay-unsupported.ts';

/**
 * The perform answerer of a replayed prepare: the n-th perform takes `inlineEffectId(scope,
 * commandId, n)`, which must equal `recorded[n]` (else `replayMismatch`), and answers
 * `inlineAnswerOf` of the `core.effect` row read in `unit`, the real unit and not the as-of view. The
 * executor is never run again. A missing row is `replayMismatch`, and so is a request that is not
 * the one the row records (its type or its input, `effectRequestDifference`); a requested row is
 * `replayUnsupported`.
 */
export function replayedPerform(input: {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly scope: Scope;
  readonly commandId: string;
  readonly recorded: readonly string[];
  readonly personalByPresence?: true;
}): RequestAnswerer['perform'] {
  const { unit, registry, scope, commandId, recorded } = input;
  let next = 0;
  return async (request) => {
    const index = next;
    next += 1;
    const effectId = inlineEffectId(scope, commandId, index);
    if (recorded[index] !== effectId) {
      throw replayMismatch(`the handler performs an inline effect the record lacks (${effectId})`);
    }
    const row = await effectRowOf(unit, registry, effectId);
    if (row === undefined) {
      throw replayMismatch(`the inline effect ${effectId} has no record`);
    }
    const difference = await effectRequestDifference({
      unit,
      registry,
      effectId,
      effect: request.effect,
      row,
      deferred: false,
      ...(input.personalByPresence === true ? { personalByPresence: true } : {}),
    });
    if (difference !== undefined) throw replayMismatch(difference);
    if (row.status === 'requested') {
      throw replayUnsupported(`the inline effect ${effectId} has not settled`);
    }
    return inlineAnswerOf(row);
  };
}
