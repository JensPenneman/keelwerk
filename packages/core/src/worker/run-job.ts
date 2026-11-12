import type { ControlStore } from '../control/control-store.ts';
import { errors } from '../errors/errors.ts';
import type { EgressPolicy } from '../executors/egress-policy.ts';
import { runDeadlineJob } from '../executors/run-deadline-job.ts';
import { runEffectJob } from '../executors/run-effect-job.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { Job } from '../jobs/job.ts';
import type { Clock } from '../kernel/clock.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { Tracer } from '../observability/tracer.ts';
import type { ServedApp } from '../runtime/served-app.ts';
import type { QueueSource } from './queue-source.ts';
import { runActionJob } from './run-action-job.ts';

/** What a worker runs a job with. */
export interface RunJobContext {
  readonly invoker: Invoker;
  /** The fencing id: the process id. */
  readonly worker: string;
  /** Where the job was taken. */
  readonly source: QueueSource;
  readonly writer: ControlStore['writer'];
  readonly clock: Clock;
  readonly random: () => number;
  readonly log: Logger;
  /** Opens the secrets an executor reveals (14.7.4). */
  readonly keys: KeyService;
  /** The backend rows an executor's configuration is read from. */
  readonly directory: ScopeLookup;
  /** The served apps by id: the module configuration shapes of a backend's app. */
  readonly apps: ReadonlyMap<string, ServedApp>;
  /** The outbound policy of this process (`RuntimeOptions.work.egress`, 12.3). */
  readonly egress: EgressPolicy | undefined;
  readonly tracer: Tracer;
}

/**
 * Runs one job (the seam of F-32) by the shape of its run: an action job goes through the invoker,
 * an effect job runs its executor outside any unit (`runEffectJob`), a deadline job settles an
 * external effect that is still `requested` (`runDeadlineJob`). Any other run is one this build
 * does not know (a job of a newer build, or a damaged row): it ends with an `internal` error that
 * names the kind and the queue and never the input, which is never retried, so the job ends at its
 * first attempt.
 */
export function runJob(job: Job, context: RunJobContext): Promise<void> {
  const { run, kind, queue } = job.stored;
  if ('action' in run) return runActionJob(job, context);
  if ('executor' in run) return runEffectJob(job, context);
  if ('effectDeadline' in run) return runDeadlineJob(job, context);
  return Promise.reject(
    errors.internal(
      `A job of kind ${kind} in the queue ${queue} has a run this build does not know.`,
    ),
  );
}
