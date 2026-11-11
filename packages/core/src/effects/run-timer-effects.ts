import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { CancelTimerEffect } from '../protocol/cancel-timer-effect.ts';
import type { SetTimerEffect } from '../protocol/set-timer-effect.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { commandActionOf } from './command-action-of.ts';
import { durationMs } from './duration-ms.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { sameScopeAction } from './same-scope-action.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/** The queue the keyed timer jobs live in (section 9.5.1). */
const timerQueue = 'timers';

/**
 * `setTimer({ key, at or after, invoke, input })`: a keyed job in the `timers` queue, committed
 * with the unit, that invokes the command under the service principal of the module whose decision
 * set it. A timer with the same key is replaced.
 */
async function setTimer(scene: EffectScene, effect: SetTimerEffect): Promise<void> {
  const { run, unit } = scene;
  const action = commandActionOf(run.registry, effect.action, 'setTimer');
  sameScopeAction(run.scope, action, 'setTimer');
  const input = validateEffectInput(action.input, effect.input, `timer "${effect.key}"`);
  const now = scene.clock.now();
  if (effect.at === undefined && effect.after === undefined) {
    throw refuseRequest(`setTimer "${effect.key}"`, 'it names neither `at` nor `after`');
  }
  const runAt = effect.at ?? now.add({ milliseconds: durationMs(effect.after ?? '0s') });
  await unit.jobs.enqueue({
    ...jobInput({
      actor: scene.causeActor,
      scope: run.scope,
      principal: moduleServicePrincipal(scene.module, run.principal),
      caller: scene.module,
      action,
      causation: {
        commandId: scene.commandId,
        ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
      },
      build: run.build,
      now,
    }),
    kind: 'action',
    queue: timerQueue,
    run: { action: action.ref, input },
    runAt,
    key: { value: effect.key, onConflict: 'replace' },
  });
}

/** `cancelTimer(key)`: cancels the pending timer job of the key. */
async function cancelTimer(scene: EffectScene, effect: CancelTimerEffect): Promise<void> {
  await scene.unit.jobs.cancel(timerQueue, effect.key);
}

/** Performs `setTimer` and `cancelTimer` effects. */
export async function runTimerEffects(
  scene: EffectScene,
  effect: SetTimerEffect | CancelTimerEffect,
): Promise<void> {
  if (effect.kind === 'setTimer') await setTimer(scene, effect);
  else await cancelTimer(scene, effect);
}
