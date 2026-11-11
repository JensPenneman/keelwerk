import type { ControlStore } from '../control/control-store.ts';
import type { EgressPolicy } from '../executors/egress-policy.ts';
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
 * Runs one job (the seam of F-32): an action job goes through the invoker, an effect job runs its
 * executor outside any unit (`runEffectJob`).
 */
export function runJob(job: Job, context: RunJobContext): Promise<void> {
  if ('action' in job.stored.run) return runActionJob(job, context);
  return runEffectJob(job, context);
}
