import { errors } from '../errors/errors.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';
import { commandActionOf } from './command-action-of.ts';
import { durationMs } from './duration-ms.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { requestedEffectDraft } from './requested-effect-draft.ts';
import { sealEffectInput } from './seal-effect-input.ts';
import { sensitiveWithMember } from './sensitive-with-member.ts';
import { validateEffectInput } from './validate-effect-input.ts';
import { writeEffectRecord } from './write-effect-record.ts';

/** The job that has a worker run an effect's executor outside any unit (decision 50a). */
async function enqueueEffectJob(
  scene: EffectScene,
  effect: ExternalEffect,
  entry: EffectEntry,
  executor: ExecutorEntry,
  id: string,
  input: unknown,
): Promise<void> {
  const { run, unit } = scene;
  const config = run.config?.(entry.module);
  const context = { config, input };
  const capability = executor.capabilityOf?.(context) ?? executor.capability;
  const group = executor.group?.(context);
  await unit.jobs.enqueue({
    ...jobInput({
      actor: scene.causeActor,
      scope: run.scope,
      principal: moduleServicePrincipal(entry.module, run.principal),
      causation: {
        commandId: scene.commandId,
        ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
      },
      build: run.build,
      now: scene.clock.now(),
    }),
    kind: 'effect',
    queue: executor.queue,
    run: { executor: executor.ref, effect: id },
    capability,
    ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
    key: { value: id, onConflict: 'keep' },
    ...(group === undefined ? {} : { group }),
    ...(executor.retry === undefined ? {} : { retry: executor.retry }),
    ...(executor.timeout === undefined
      ? {}
      : { expireInSeconds: Math.ceil(durationMs(executor.timeout) / 1000) }),
  });
}

/**
 * Records an external effect a decision requested (section 7.9.6): the `requested` row of the
 * stream `core.effect/<id>` in this unit, with the input as declared (validated, secrets sealed
 * as references, personal values sealed under their data subject's key), the command and events
 * it accompanies, its continuation, key and deadline; and, for an effect with an executor, the
 * effect job a worker takes after commit. An effect with an outside performer has the record
 * only; the performer finds it through the live subscription. The record and the job commit or
 * roll back with the unit, and a repeated decision requests the same id.
 */
export async function recordExternalEffect(
  scene: EffectScene,
  effect: ExternalEffect,
  id: string,
): Promise<void> {
  const { registry } = scene.run;
  const entry = registry.effects.get(effect.type);
  if (entry === undefined) {
    throw refuseRequest(`the effect "${effect.type}"`, 'no module of this app declares it');
  }
  const input = await sealEffectInput({
    unit: scene.unit,
    registry,
    entry,
    effectId: id,
    input: validateEffectInput(entry.input, effect.input, `the effect "${entry.ref}"`),
  });
  if (effect.continueWith !== undefined) {
    const continuation = commandActionOf(registry, effect.continueWith, 'continueWith');
    const member =
      effect.with === undefined ? undefined : sensitiveWithMember(continuation, effect.with);
    if (member !== undefined) {
      throw refuseRequest(
        `the effect "${entry.ref}"`,
        `its with member "${member}" is personal or secret in ${continuation.ref}, and a record keeps with in plaintext`,
      );
    }
  }
  await writeEffectRecord(scene, requestedEffectDraft(scene, effect, entry, id, input));
  if (entry.performer === 'external') return;
  const executor = entry.executor === null ? undefined : registry.executors.get(entry.executor);
  if (executor === undefined) {
    throw errors.internal(`the effect "${entry.ref}" has no executor to perform it`);
  }
  await enqueueEffectJob(scene, effect, entry, executor, id, input);
}
