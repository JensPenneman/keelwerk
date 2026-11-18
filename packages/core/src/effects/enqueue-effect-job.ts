import type { ActorRef } from '../principals/actor-ref.ts';
import type { Principal } from '../principals/principal.ts';
import type { ReactionLineage } from '../reactions/reaction-lineage.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { ExecutorEntry } from '../registry/executor-entry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { durationMs } from './duration-ms.ts';
import { executorOptionInput } from './executor-option-input.ts';
import { jobInput } from './job-input.ts';

/** What the job that has a worker run an effect's executor is built from. */
export interface EffectJob {
  readonly scope: Scope;
  readonly entry: EffectEntry;
  readonly executor: ExecutorEntry;
  readonly effectId: string;
  /** The effect's input as recorded (personal values sealed): only the executor's `group` and `capabilityOf` read it, through `executorOptionInput`. */
  readonly input: unknown;
  /** The module's configuration for the backend, as `ctx.config` answers it. */
  readonly config: unknown;
  /** Who the job acts as. */
  readonly principal: Principal;
  /** Who caused the job; the principal's own when absent. */
  readonly actor?: ActorRef;
  /** The module whose code builds the job. */
  readonly caller: string;
  readonly causation: {
    readonly commandId?: string;
    readonly eventId?: string;
    readonly lineage?: ReactionLineage;
  };
  readonly build: { readonly id: string; readonly revision: number };
  readonly now: Temporal.Instant;
  readonly runAt?: Temporal.Instant;
}

/**
 * The job that has a worker run an effect's executor outside any unit (decision 50a), keyed by the
 * effect id with `onConflict: 'keep'`, so enqueueing the same effect again leaves a job that is
 * still there as it is.
 */
export async function enqueueEffectJob(unit: Unit, job: EffectJob): Promise<void> {
  const { executor } = job;
  const context = { config: job.config, input: executorOptionInput(job.entry, job.input) };
  const capability = executor.capabilityOf?.(context) ?? executor.capability;
  const group = executor.group?.(context);
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
    queue: executor.queue,
    run: { executor: executor.ref, effect: job.effectId },
    capability,
    ...(job.runAt === undefined ? {} : { runAt: job.runAt }),
    key: { value: job.effectId, onConflict: 'keep' },
    ...(group === undefined ? {} : { group }),
    ...(executor.retry === undefined ? {} : { retry: executor.retry }),
    ...(executor.timeout === undefined
      ? {}
      : { expireInSeconds: Math.ceil(durationMs(executor.timeout) / 1000) }),
  });
}
