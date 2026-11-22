import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { QueueLimits } from './queue-limits.ts';
import { queueMemberBounds } from './queue-member-bounds.ts';

/** The lane cap of a queue when no limits are known. */
const defaultLaneCap = 4;

/**
 * The lane members of a job from its queue's limits in its scope, judged separately: the cap is
 * `running` rounded down, between 0 and 2,147,483,647, and a `running` that is not finite gives
 * cap 4; the weight is `weight` rounded down, between 1 and 2,147,483,647, and a `weight` that is
 * not finite gives no weight (the lane columns are integers). Without limits the cap is 4 and there
 * is no weight (a new lane gets 1, an existing lane keeps its own). No enqueue path passes limits
 * yet, so until the paths are wired every lane keeps cap 4 and its weight; only the queued cap of a
 * command job (`commandQueuedCap`) is read from the quota limits today.
 */
export function laneLimitsOf(
  limits: QueueLimits | undefined,
): Pick<StoredJobSpec, 'laneCap' | 'laneWeight'> {
  if (limits === undefined) return { laneCap: defaultLaneCap };
  const laneCap = Number.isFinite(limits.running)
    ? Math.min(
        queueMemberBounds.max,
        Math.max(queueMemberBounds.minCap, Math.floor(limits.running)),
      )
    : defaultLaneCap;
  if (!Number.isFinite(limits.weight)) return { laneCap };
  const laneWeight = Math.min(
    queueMemberBounds.max,
    Math.max(queueMemberBounds.minWeight, Math.floor(limits.weight)),
  );
  return { laneCap, laneWeight };
}
