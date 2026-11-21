import { checkCallerCommandId } from '../ids/check-caller-command-id.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { EnqueueEffect } from '../protocol/enqueue-effect.ts';
import { commandQueuedCap } from '../quotas/command-queued-cap.ts';
import { checkEffectScope } from './check-effect-scope.ts';
import { commandActionOf } from './command-action-of.ts';
import { commandJobRun } from './command-job-run.ts';
import { commandQueue } from './command-queue.ts';
import { crossScopeGroup } from './cross-scope-group.ts';
import type { EffectScene } from './effect-scene.ts';
import { enqueueKey } from './enqueue-key.ts';
import { jobInput } from './job-input.ts';
import { jobKeyDigest } from './job-key-digest.ts';
import { jobKeySecretOf } from './job-key-secret-of.ts';
import { sealJobInput } from './seal-job-input.ts';
import { validateEffectInput } from './validate-effect-input.ts';

/**
 * `enqueue(action, input, { runAt?, key?, commandId? })`: a command job committed with the unit
 * (section 7.9.5). The job runs the command later under the principal that enqueued it, resolved
 * again then, with `commandId` (the option, which `checkCallerCommandId` keeps out of the kernel's
 * form and to a UUID of version 4 or 7, or a ULID, else the kernel form of the effect's derived
 * id) as its command id so someone can follow it. The caller's build and API version travel with
 * it, and the secret members of the input are sealed in the job row (`sealJobInput`). A backend
 * command named from a tenant unit is enqueued the same way: the job stays in the tenant's unit
 * and commits with the decision, and the invoker runs it in the tenant's own backend unit
 * (`checkEffectScope`). Its command id is the kernel's: a `commandId` chosen in a tenant would
 * name a receipt in the backend that every tenant of that backend shares, so one tenant's run
 * would suppress another's and it is refused. A `key` is stored as its digest under the scope's
 * job key secret (`jobKeyDigest`): the key may hold a personal value, so the text never reaches
 * the job row, and the same key in the same scope still finds its job. The job belongs to the
 * backend's cross-scope group (`crossScopeGroup`), so the commands of one backend that wait on its
 * row locks never take every slot of the queue. A key is stored under the enqueuing module's id
 * (`enqueueKey`), so two modules of one scope never keep each other's job.
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
  checkCallerCommandId(effect.commandId);
  if (placement === 'backend' && effect.commandId !== undefined) {
    throw refuseRequest(
      `enqueue of "${action.ref}"`,
      'a command id chosen in a tenant names a receipt its backend shares with every tenant',
    );
  }
  const commandId = effect.commandId ?? kernelCommandId('effect', id);
  const cap = commandQueuedCap(run, action);
  const secret = effect.key === undefined ? undefined : await jobKeySecretOf(run);
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
        ...(scene.meta.lineage === undefined ? {} : { lineage: scene.meta.lineage }),
      },
      build: run.build,
      apiVersion: run.apiVersion,
      now: scene.clock.now(),
    }),
    kind: 'action',
    queue: commandQueue,
    ...(cap === undefined ? {} : { queuedCap: cap }),
    run: commandJobRun(
      action.ref,
      await sealJobInput(unit, run.registry, commandId, action, input),
      commandId,
    ),
    ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
    ...(effect.key === undefined || secret === undefined
      ? {}
      : {
          key: {
            value: enqueueKey(scene.module, jobKeyDigest(secret, scene.module, effect.key)),
            onConflict: 'keep',
          },
        }),
    ...(placement === 'backend' && run.scope.level === 'tenant'
      ? { group: crossScopeGroup(run.scope.backendId) }
      : {}),
  });
}
