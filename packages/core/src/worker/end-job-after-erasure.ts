import { timerQueue } from '../effects/timer-queue.ts';
import { toWire } from '../errors/to-wire.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { PersonalKeyDestroyed } from '../write-path/personal-key-destroyed.ts';
import { countKeyDestroyedJob } from './count-key-destroyed-job.ts';
import type { RunJobContext } from './run-job.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';

/**
 * Ends a job whose personal member can no longer be opened, because the subject's data key was
 * destroyed by an erasure (14.7.5): no retry and no dead letter, one info line that does not name
 * the subject, and one count on `keelwerk.jobs.key_destroyed`, both written after the settle has
 * committed. A timer ends `succeeded` without a
 * receipt: it was only waiting to run a command for the erased subject. A command job ends `failed`
 * with the closed code `core.key_destroyed`, and `settleJobAttempt` fails the receipt of its
 * command with it, so the submitter reads why nothing ran.
 */
export async function endJobAfterErasure(
  context: Pick<RunJobContext, 'source' | 'worker' | 'writer' | 'clock' | 'log' | 'meter'>,
  stored: StoredJob,
  error: PersonalKeyDestroyed,
): Promise<void> {
  const timer = stored.queue === timerQueue;
  await settleJobAttempt(
    context,
    stored,
    timer
      ? { kind: 'succeeded' }
      : { kind: 'failed', error: { ...toWire(error, 'public'), requestId: '' } },
  );
  // After the commit: a settle that fails or finds the lease lost leaves the job to its next taker,
  // which writes the line and counts again, so each job is logged and counted once.
  context.log.info(
    timer
      ? 'a timer ended without running: the data subject of a personal member was erased'
      : 'a job ended without running: the data subject of a personal member was erased',
    {
      queue: stored.queue,
      jobId: stored.id,
      ...('action' in stored.run ? { action: stored.run.action } : {}),
    },
  );
  countKeyDestroyedJob(stored.queue, context.meter);
}
