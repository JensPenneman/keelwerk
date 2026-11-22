import type { Scope } from '../storage/scope.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { queueMemberBounds } from './queue-member-bounds.ts';
import type { QuotaView } from './quota-view.ts';

/** The lane cap of a queue in the deployment scope, and of any queue when no limits are known. */
const defaultLaneCap = 4;

/**
 * The lane members of a job from its queue's limits in its scope, judged separately: the cap is
 * `running` rounded down, between 0 and 2,147,483,647, and a `running` that is not finite gives
 * cap 4; the weight is `weight` rounded down, between 1 and 2,147,483,647, and a `weight` that is
 * not finite gives no weight (the lane columns are integers). A lane of the deployment scope, and
 * a job enqueued without a view of the limits, get cap 4 and no weight (a new lane gets 1, an
 * existing lane keeps its own). `limits` is required, so no enqueue leaves the limits out without
 * saying so.
 */
export function laneLimitsOf(
  limits: QuotaView | undefined,
  scope: Scope,
  queue: string,
): Pick<StoredJobSpec, 'laneCap' | 'laneWeight'> {
  if (limits === undefined || scope.level === 'deployment') return { laneCap: defaultLaneCap };
  const { running, weight } = limits.queueOf(scope, queue);
  const laneCap = Number.isFinite(running)
    ? Math.min(queueMemberBounds.max, Math.max(queueMemberBounds.minCap, Math.floor(running)))
    : defaultLaneCap;
  if (!Number.isFinite(weight)) return { laneCap };
  const laneWeight = Math.min(
    queueMemberBounds.max,
    Math.max(queueMemberBounds.minWeight, Math.floor(weight)),
  );
  return { laneCap, laneWeight };
}
