import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { QueueLimits } from './queue-limits.ts';

/** The lane cap of a queue when no limits are known. */
const defaultLaneCap = 4;

/** The largest value of the integer columns `kw_job_lanes.cap` and `kw_job_lanes.weight`. */
const largestInteger = 2_147_483_647;

/**
 * The lane members of a job from its queue's limits in its scope: the cap is the whole number
 * below `running`, at most 2,147,483,647, and the weight the whole number below `weight`, between
 * 1 and 2,147,483,647 (the lane columns are integers). A value that is not finite gives cap 4 and
 * no weight. Without limits the cap is 4 and there is no weight (a new lane gets 1, an existing
 * lane keeps its own).
 */
export function laneLimitsOf(
  limits: QueueLimits | undefined,
): Pick<StoredJobSpec, 'laneCap' | 'laneWeight'> {
  if (limits === undefined) return { laneCap: defaultLaneCap };
  const laneCap = Number.isFinite(limits.running)
    ? Math.min(largestInteger, Math.max(0, Math.floor(limits.running)))
    : defaultLaneCap;
  if (!Number.isFinite(limits.weight)) return { laneCap };
  return { laneCap, laneWeight: Math.min(largestInteger, Math.max(1, Math.floor(limits.weight))) };
}
