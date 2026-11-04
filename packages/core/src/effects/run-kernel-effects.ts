import { dispatchInlineReactions } from '../reactions/dispatch-inline-reactions.ts';
import type { EffectScene } from './effect-scene.ts';
import type { KernelEffectsInput } from './kernel-effects-input.ts';
import { performEffects } from './perform-effects.ts';

/**
 * Phase 6 of section 7.9.4 after the decision's events are appended: the inline reactions to
 * those events decide in module order (and to the events they write in turn), then the decision's
 * own effects run in order, then the effects the reactions requested, in the order the reactions
 * ran. `invoke` runs a command in a savepoint, `enqueue` and timers write job rows, an external
 * effect writes its `requested` record and its effect job. Answers the ids of the deferred
 * effects; anything that fails fails the unit, which the caller rolls back whole.
 */
export async function runKernelEffects(input: KernelEffectsInput): Promise<readonly string[]> {
  const { run } = input;
  const scene: EffectScene = {
    unit: input.unit,
    run,
    clock: input.clock,
    module: run.action.contributedBy ?? run.action.module,
    causeActor: input.meta.actor,
    commandId: input.commandId,
    cause: input.commandId,
    depth: input.depth ?? 0,
    meta: input.meta,
    eventIds: input.written.flatMap((item) => item.events.map((event) => event.eventId)),
    hybridClock: input.hybridClock,
    runNested: input.runNested,
  };
  const reacted = await dispatchInlineReactions(scene, input.written, scene.depth + 1);
  const deferred = [...(await performEffects(scene, input.effects))];
  for (const reaction of reacted) {
    deferred.push(...(await performEffects(reaction.scene, reaction.effects)));
  }
  return deferred;
}
