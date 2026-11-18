import type { RestoreHoldRefusal } from '../control/restore-hold-refusal.ts';
import { toWire } from '../errors/to-wire.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from './run-job.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';

/**
 * Gives back a job of a tenant that a restore holds (14.7.6): the attempt is completed as a retry
 * that uses no attempt, after as long as the refusal asks (one second), so the job waits for the
 * end of the hold however many attempts it has used and whatever `giveUpAfter` says.
 */
export function settleHeldJob(
  context: Pick<RunJobContext, 'source' | 'worker' | 'writer' | 'clock'>,
  stored: StoredJob,
  refusal: RestoreHoldRefusal,
): Promise<void> {
  const wait = Math.ceil((refusal.retryAfter ?? 1) * 1000);
  return settleJobAttempt(context, stored, {
    kind: 'retry',
    at: context.clock.now().add({ milliseconds: wait }),
    error: { ...toWire(refusal, 'public'), requestId: '' },
    uncounted: true,
  });
}
