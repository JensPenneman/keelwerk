import { laneLimitsOf } from '../quotas/lane-limits-of.ts';
import { queuedCapOf } from '../quotas/queued-cap-of.ts';
import type { QuotaView } from '../quotas/quota-view.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { type JobCauseOptions, jobCauseOf } from './job-cause-of.ts';

/** What a job of a worker's queue is built from: the common members and the queue's limits. */
export interface JobInputOptions extends JobCauseOptions {
  /** The queue the job joins: its lane's cap and weight, and its queued cap, come from the limits of this queue in the job's scope. */
  readonly queue: string;
  /**
   * What the limits are read from, asked for fresh rows before the unit that enqueues (`QuotaLimits.fresh`);
   * `undefined` only where a process runs without quotas: the default lane and no queued cap.
   */
  readonly limits: QuotaView | undefined;
  /**
   * Why the job does not carry the queued cap of its queue (9.5.5): it is counted, never refused.
   * `accepted`: the framework has accepted it already (a continuation, the re-enqueue at a restore).
   * `definition`: the app's own definition asks for it and it must not be lost (a schedule's tick, a tenant hook).
   * Absent: what a decision or a request asks for anew, which meets the cap.
   */
  readonly exempt?: 'accepted' | 'definition';
}

/**
 * The members every job a unit enqueues in a worker's queue shares: those of `jobCauseOf`, the
 * queue, the lane's cap and weight from the limits of the queue in the job's scope
 * (`laneLimitsOf`) and, unless `exempt` says why not, the queued cap (`queuedCapOf`). `queue` and
 * `limits` are required, so a path cannot leave the limits out without saying so. The `run` and
 * the options of the job come from the caller.
 */
export function jobInput(
  options: JobInputOptions,
): Pick<
  StoredJobSpec,
  | 'queue'
  | 'laneCap'
  | 'laneWeight'
  | 'queuedCap'
  | 'createdAt'
  | 'scope'
  | 'principal'
  | 'causation'
  | 'build'
  | 'apiVersion'
> {
  const { scope, queue, limits } = options;
  const cap =
    options.exempt === undefined
      ? queuedCapOf(limits, scope, queue, options.action?.module ?? options.caller)
      : undefined;
  return {
    ...jobCauseOf(options),
    queue,
    ...laneLimitsOf(limits, scope, queue),
    ...(cap === undefined ? {} : { queuedCap: cap }),
  };
}
