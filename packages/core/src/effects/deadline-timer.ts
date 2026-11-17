import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { EffectScene } from './effect-scene.ts';
import { jobInput } from './job-input.ts';
import { timerKey } from './timer-key.ts';
import { timerQueue } from './timer-queue.ts';

/**
 * The deadline timer of an external effect (7.9.5): a job in `timers` at `deadline`, keyed
 * `core:deadline:<id>` (`timerKey` of the module `core`, kept on conflict), kind `effect`, run
 * `{ effectDeadline: id }`, committed with the requested record. A module's timer keys are stored
 * under its own module id, so none reaches a `core:` key; `checkTimerKey` keeps a module key from
 * reading as a kernel key. The kernel shares the namespace `core` with the core module's own
 * decisions, which set no timer.
 */
export async function enqueueDeadlineTimer(
  scene: EffectScene,
  entry: EffectEntry,
  id: string,
  deadline: Temporal.Instant,
): Promise<void> {
  const { run } = scene;
  await scene.unit.jobs.enqueue({
    ...jobInput({
      actor: scene.causeActor,
      scope: run.scope,
      principal: moduleServicePrincipal(entry.module, run.principal),
      caller: scene.module,
      causation: {
        commandId: scene.commandId,
        ...(scene.causeEventId === undefined ? {} : { eventId: scene.causeEventId }),
        ...(scene.meta.lineage === undefined ? {} : { lineage: scene.meta.lineage }),
      },
      build: run.build,
      now: scene.clock.now(),
    }),
    kind: 'effect',
    queue: timerQueue,
    run: { effectDeadline: id },
    runAt: deadline,
    key: { value: timerKey('core', `deadline:${id}`), onConflict: 'keep' },
  });
}
