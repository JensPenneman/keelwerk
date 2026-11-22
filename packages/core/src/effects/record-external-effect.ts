import { errors } from '../errors/errors.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { commandActionOf } from './command-action-of.ts';
import { enqueueDeadlineTimer } from './deadline-timer.ts';
import type { EffectScene } from './effect-scene.ts';
import { enqueueEffectJob } from './enqueue-effect-job.ts';
import { jobKeyDigest } from './job-key-digest.ts';
import { jobKeySecretOf } from './job-key-secret-of.ts';
import { requestedEffectDraft } from './requested-effect-draft.ts';
import { sealEffectInput } from './seal-effect-input.ts';
import { sensitiveWithMember } from './sensitive-with-member.ts';
import { validateEffectInput } from './validate-effect-input.ts';
import { writeEffectRecord } from './write-effect-record.ts';

/**
 * Records an external effect a decision requested (section 7.9.6): the `requested` row of the
 * stream `core.effect/<id>` in this unit, with the input as declared (validated, secrets sealed
 * as references, personal values sealed under their data subject's key), the command and events
 * it accompanies, its continuation, key and deadline; the key a module chose is stored as its
 * digest under the scope's job key secret, bound to the module (`jobKeyDigest`), never as the text,
 * in the row and in the requested event; and, for an effect with an executor, the
 * effect job a worker takes after commit. An effect with an outside performer has the record
 * and, when it has a deadline, the deadline timer (`enqueueDeadlineTimer`); the performer finds it
 * through the live subscription. An outside performer's effect with `runAt` is a validation error
 * until it is designed: nothing would withhold the pending effect until then. The record and the job commit or
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
  if (entry.performer === 'external' && effect.runAt !== undefined) {
    throw errors.validation(
      `The effect "${entry.ref}" has an outside performer, which runAt does not serve yet.`,
      { issues: [{ path: ['runAt'], message: 'Not available for an outside performer.' }] },
    );
  }
  const input = await sealEffectInput({
    unit: scene.unit,
    registry,
    entry,
    effectId: id,
    input: validateEffectInput(entry.input, effect.input, `the effect "${entry.ref}"`),
  });
  let requested = effect;
  if (effect.continueWith !== undefined) {
    const continuation = commandActionOf(registry, effect.continueWith, 'continueWith');
    if (continuation.module !== scene.module) {
      throw refuseRequest(
        `the effect "${entry.ref}"`,
        'its continuation is no command of the module whose decision requests it',
      );
    }
    const member =
      effect.with === undefined ? undefined : sensitiveWithMember(continuation, effect.with);
    if (member !== undefined) {
      throw refuseRequest(
        `the effect "${entry.ref}"`,
        `its with member "${member}" is personal or secret in ${continuation.ref}, and a record keeps with in plaintext`,
      );
    }
    if (effect.with !== undefined && continuation.outcomeWith !== undefined) {
      requested = {
        ...effect,
        with: validateEffectInput(
          continuation.outcomeWith,
          effect.with,
          `the with of the effect "${entry.ref}"`,
        ) as Readonly<Record<string, unknown>>,
      };
    }
  }
  if (requested.key !== undefined) {
    const secret = await jobKeySecretOf(scene.run);
    requested = { ...requested, key: jobKeyDigest(secret, scene.module, requested.key) };
  }
  await writeEffectRecord(scene, requestedEffectDraft(scene, requested, entry, id, input));
  if (entry.performer === 'external') {
    if (requested.deadline !== undefined) {
      await enqueueDeadlineTimer(scene, entry, id, requested.deadline);
    }
    return;
  }
  const executor = entry.executor === null ? undefined : registry.executors.get(entry.executor);
  if (executor === undefined) {
    throw errors.internal(`the effect "${entry.ref}" has no executor to perform it`);
  }
  await enqueueEffectJob(scene.unit, {
    scope: scene.run.scope,
    entry,
    executor,
    effectId: id,
    input,
    config: scene.run.config?.(entry.module),
    principal: moduleServicePrincipal(entry.module, scene.run.principal),
    actor: scene.causeActor,
    caller: scene.module,
    causation: {
      commandId: scene.commandId,
      ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
      ...(scene.meta.lineage === undefined ? {} : { lineage: scene.meta.lineage }),
    },
    build: scene.run.build,
    now: scene.clock.now(),
    limits: scene.run.quotas,
    ...(requested.runAt === undefined ? {} : { runAt: requested.runAt }),
  });
}
