import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { queueMemberBounds } from '../quotas/queue-member-bounds.ts';
import type { StoredJobSpec } from './stored-job-spec.ts';

const refuse = (message: string): KeelwerkError =>
  new KeelwerkError({ kind: 'validation', code: 'core.malformed_request', message });

/**
 * Refuses the lane members of a stored job spec that a lane cannot hold, with
 * `core.malformed_request`, before an enqueue writes anything: the cap is a whole number from 0
 * (the lane is held: nothing of it is taken) and the weight a whole number from 1 (the fair take
 * divides by it), both up to 2,147,483,647, the integer columns of the lane row. A weight that is
 * absent is fine. A queued cap, when set, is a safe whole number from 0 (nothing more is admitted
 * to the queue), the range of a count quota; the commit tail binds it into a statement. Every job store calls it first, so that every store refuses the same values.
 */
export function checkLaneMembers(
  spec: Pick<StoredJobSpec, 'laneCap' | 'laneWeight' | 'queuedCap'>,
): void {
  const { max, minCap, minWeight } = queueMemberBounds;
  const { laneCap, laneWeight, queuedCap } = spec;
  if (!Number.isInteger(laneCap) || laneCap < minCap || laneCap > max) {
    throw refuse(`a lane cap is a whole number from ${minCap} to ${max}`);
  }
  if (
    laneWeight !== undefined &&
    (!Number.isInteger(laneWeight) || laneWeight < minWeight || laneWeight > max)
  ) {
    throw refuse(`a lane weight is a whole number from ${minWeight} to ${max}`);
  }
  if (queuedCap !== undefined && (!Number.isSafeInteger(queuedCap) || queuedCap < 0)) {
    throw refuse('a queued cap is a safe whole number from 0');
  }
}
