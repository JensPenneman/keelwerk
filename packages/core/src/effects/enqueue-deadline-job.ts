import type { ActorRef } from '../principals/actor-ref.ts';
import type { Principal } from '../principals/principal.ts';
import type { ReactionLineage } from '../reactions/reaction-lineage.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { deadlineTimerKey } from './deadline-timer-key.ts';
import { jobInput } from './job-input.ts';
import { timerQueue } from './timer-queue.ts';

/** What the deadline timer of an external effect is built from. */
export interface DeadlineJob {
  readonly scope: Scope;
  readonly principal: Principal;
  /** Who caused the job; the principal's own when absent. */
  readonly actor?: ActorRef;
  readonly caller: string;
  readonly causation: {
    readonly commandId?: string;
    readonly eventId?: string;
    readonly lineage?: ReactionLineage;
  };
  readonly build: { readonly id: string; readonly revision: number };
  readonly now: Temporal.Instant;
  readonly effectId: string;
  readonly deadline: Temporal.Instant;
}

/**
 * The job in `timers` that settles an external effect at its deadline (7.9.5): kind `effect`, run
 * `{ effectDeadline: id }`, keyed `core.deadline:<id>` (`deadlineTimerKey`) and kept on conflict, so enqueueing the same
 * effect again leaves a timer that is still there as it is.
 */
export async function enqueueDeadlineJob(unit: Unit, job: DeadlineJob): Promise<void> {
  await unit.jobs.enqueue({
    ...jobInput({
      ...(job.actor === undefined ? {} : { actor: job.actor }),
      scope: job.scope,
      principal: job.principal,
      caller: job.caller,
      causation: job.causation,
      build: job.build,
      now: job.now,
    }),
    kind: 'effect',
    queue: timerQueue,
    run: { effectDeadline: job.effectId },
    runAt: job.deadline,
    key: { value: deadlineTimerKey(job.effectId), onConflict: 'keep' },
  });
}
