import type { EnqueueEffect } from '../protocol/enqueue-effect.ts';
import { commandActionOf } from './command-action-of.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { sameScopeAction } from './same-scope-action.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `enqueue(action, input, { runAt?, key?, commandId? })`: a command job committed with the unit
 * (section 7.9.5). The job runs the command later under the principal that enqueued it, resolved
 * again then, with `commandId` (the option, else the effect's derived id) as its command id so
 * someone can follow it. The caller's build and API version travel with it.
 */
export async function runEnqueueEffect(
  scene: EffectScene,
  effect: EnqueueEffect,
  id: string,
): Promise<void> {
  const { run, unit } = scene;
  const action = commandActionOf(run.registry, effect.action, 'enqueue');
  sameScopeAction(run.scope, action, 'enqueue');
  const input = validateEffectInput(action.input, effect.input, `"${action.ref}"`);
  await unit.jobs.enqueue({
    ...jobInput({
      actor: scene.causeActor,
      scope: run.scope,
      principal: run.principal,
      causation: {
        commandId: scene.commandId,
        ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
      },
      build: run.build,
      apiVersion: run.apiVersion,
      now: scene.clock.now(),
    }),
    kind: 'action',
    queue: commandQueue,
    run: commandJobRun(action.ref, input, effect.commandId ?? id),
    ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
    ...(effect.key === undefined ? {} : { key: { value: effect.key, onConflict: 'keep' } }),
  });
}
