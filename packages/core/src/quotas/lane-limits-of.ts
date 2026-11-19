import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { QueueLimits } from './queue-limits.ts';

/** The lane cap of a queue when no limits are known. */
const defaultLaneCap = 4;

/** The lane members of a job from its queue's limits in its scope; without limits cap 4 and no weight (a new lane gets 1, an existing lane keeps its own). */
export function laneLimitsOf(
  limits: QueueLimits | undefined,
): Pick<StoredJobSpec, 'laneCap' | 'laneWeight'> {
  if (limits === undefined) return { laneCap: defaultLaneCap };
  return {
    laneCap: Math.max(0, Math.floor(limits.running)),
    laneWeight: Math.max(1, Math.floor(limits.weight)),
  };
}
