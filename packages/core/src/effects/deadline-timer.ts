import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { EffectScene } from './effect-scene.ts';
import { enqueueDeadlineJob } from './enqueue-deadline-job.ts';

/**
 * The deadline timer of an external effect (7.9.5): a job in `timers` at `deadline`, keyed
 * `core.deadline:<id>` (`deadlineTimerKey`, kept on conflict), a namespace no module's timer key
 * can reach, kind `effect`, run `{ effectDeadline: id }`, committed with the requested record.
 */
export async function enqueueDeadlineTimer(
  scene: EffectScene,
  entry: EffectEntry,
  id: string,
  deadline: Temporal.Instant,
): Promise<void> {
  const { run } = scene;
  await enqueueDeadlineJob(scene.unit, {
    scope: run.scope,
    principal: moduleServicePrincipal(entry.module, run.principal),
    actor: scene.causeActor,
    caller: scene.module,
    causation: {
      commandId: scene.commandId,
      ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
      ...(scene.meta.lineage === undefined ? {} : { lineage: scene.meta.lineage }),
    },
    build: run.build,
    now: scene.clock.now(),
    effectId: id,
    deadline,
  });
}
