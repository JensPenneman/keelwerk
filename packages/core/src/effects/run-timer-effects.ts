import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { CancelTimerEffect } from '../protocol/cancel-timer-effect.ts';
import type { SetTimerEffect } from '../protocol/set-timer-effect.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { checkTimerScope } from './check-timer-scope.ts';
import { commandActionOf } from './command-action-of.ts';
import { commandJobRun } from './command-job-run.ts';
import { durationMs } from './duration-ms.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { sealJobInput } from './seal-job-input.ts';
import { timerKey } from './timer-key.ts';
import { timerQueue } from './timer-queue.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `setTimer({ key, at or after, invoke, input })`: a keyed job in the `timers` queue, committed
 * with the unit, that invokes the command under the service principal of the module whose decision
 * set it, under the kernel command id of the timer's effect (`kernel:timer:<effect id>`). The
 * command is one of the unit's own scope: a timer does not cross scopes (`checkTimerScope`, judged
 * for the principal of the decision). A timer with the same key is replaced; it is stored under the
 * key of its module (`timerKey`), so a module reaches only its own timers. The secret members of
 * the input are sealed under value keys and the personal ones under the data key of the subject
 * they name, which is resolved in the setting unit (`sealJobInput`); a subject that was erased
 * fails the setting command, and one erased later ends the timer without running it
 * (`endJobAfterErasure`).
 */
async function setTimer(scene: EffectScene, effect: SetTimerEffect, id: string): Promise<void> {
  const { run, unit } = scene;
  const action = commandActionOf(run.registry, effect.action, 'setTimer');
  checkTimerScope(run.scope, action, run.principal);
  const input = validateEffectInput(action.input, effect.input, `timer "${effect.key}"`);
  const now = scene.clock.now();
  if (effect.at === undefined && effect.after === undefined) {
    throw refuseRequest(`setTimer "${effect.key}"`, 'it names neither `at` nor `after`');
  }
  const commandId = kernelCommandId('timer', id);
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
        ...(scene.meta.lineage === undefined ? {} : { lineage: scene.meta.lineage }),
      },
      build: run.build,
      now,
    }),
    kind: 'action',
    queue: timerQueue,
    run: commandJobRun(
      action.ref,
      await sealJobInput(unit, run.registry, commandId, action, input),
      commandId,
    ),
    runAt,
    key: { value: timerKey(scene.module, effect.key), onConflict: 'replace' },
  });
}

/**
 * `cancelTimer(key)`: cancels the timer of the key that this module set: the pending job, or in
 * `timers` its running attempt (`JobStore.cancel`).
 */
async function cancelTimer(scene: EffectScene, effect: CancelTimerEffect): Promise<void> {
  await scene.unit.jobs.cancel(timerQueue, timerKey(scene.module, effect.key));
}

/**
 * Performs `setTimer` and `cancelTimer` effects, each on the key of the deciding module
 * (`timerKey`).
 */
export async function runTimerEffects(
  scene: EffectScene,
  effect: SetTimerEffect | CancelTimerEffect,
  id: string,
): Promise<void> {
  if (effect.kind === 'setTimer') await setTimer(scene, effect, id);
  else await cancelTimer(scene, effect);
}
