import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { refuseReservedCommandId } from '../ids/refuse-reserved-command-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { EnqueueEffect } from '../protocol/enqueue-effect.ts';
import { checkEffectScope } from './check-effect-scope.ts';
import { commandActionOf } from './command-action-of.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import { crossScopeGroup } from './cross-scope-group.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { sealJobInput } from './seal-job-input.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `enqueue(action, input, { runAt?, key?, commandId? })`: a command job committed with the unit
 * (section 7.9.5). The job runs the command later under the principal that enqueued it, resolved
 * again then, with `commandId` (the option, which `refuseReservedCommandId` keeps out of the
 * kernel's form, else the kernel form of the effect's derived id) as its command id so someone can
 * follow it. The caller's build and API version travel with it, and the secret members
 * of the input are sealed in the job row (`sealJobInput`). A backend command named from a tenant
 * unit is enqueued the same way: the job stays in the tenant's unit and commits with the decision,
 * and the invoker runs it in the tenant's own backend unit (`checkEffectScope`). Its command id is
 * the kernel's: a `commandId` chosen in a tenant would name a receipt in the backend that every
 * tenant of that backend shares, so one tenant's run would suppress another's and it is refused.
 * The job belongs to the backend's cross-scope group (`crossScopeGroup`), so the commands of one
 * backend that wait on its row locks never take every slot of the queue.
 */
export async function runEnqueueEffect(
  scene: EffectScene,
  effect: EnqueueEffect,
  id: string,
): Promise<void> {
  const { run, unit } = scene;
  const action = commandActionOf(run.registry, effect.action, 'enqueue');
  const placement = checkEffectScope(run.scope, action, 'enqueue', run.principal);
  const input = validateEffectInput(action.input, effect.input, `"${action.ref}"`);
  refuseReservedCommandId(effect.commandId);
  if (placement === 'backend' && effect.commandId !== undefined) {
    throw refuseRequest(
      `enqueue of "${action.ref}"`,
      'a command id chosen in a tenant names a receipt its backend shares with every tenant',
    );
  }
  const commandId = effect.commandId ?? kernelCommandId('effect', id);
  await unit.jobs.enqueue({
    ...jobInput({
      actor: scene.causeActor,
      scope: run.scope,
      principal: run.principal,
      caller: scene.module,
      action,
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
    run: commandJobRun(action.ref, await sealJobInput(unit, commandId, action, input), commandId),
    ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
    ...(effect.key === undefined ? {} : { key: { value: effect.key, onConflict: 'keep' } }),
    ...(placement === 'backend' && run.scope.level === 'tenant'
      ? { group: crossScopeGroup(run.scope.backendId) }
      : {}),
  });
}
