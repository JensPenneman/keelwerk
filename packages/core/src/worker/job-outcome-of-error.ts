import { durationMs } from '../effects/duration-ms.ts';
import { errors } from '../errors/errors.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { toWire } from '../errors/to-wire.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { retryDelay } from './retry-delay.ts';

/** Whether the error taxonomy lets the job's policy retry it (9.5.4): everything else gives up at once. */
function retriable(error: KeelwerkError): boolean {
  switch (error.kind) {
    case 'unavailable':
      return true;
    case 'rate_limited':
    case 'conflict':
      return error.retryable;
    default:
      return false;
  }
}

/**
 * How an attempt that failed with `error` ends (9.5.4, D4, D5): undefined for `core.job_lease_lost`,
 * because a worker that lost its lease completes nothing; a retry when the taxonomy allows it, the
 * policy still has attempts and `giveUpAfter` has not passed, at the later of the jittered delay and
 * the error's `retryAfter`; otherwise the job gives up, as a dead letter when it names a
 * `deadLetter` and as history only when it does not. The error is stored as the public audience
 * sees it.
 */
export function jobOutcomeOfError(
  error: unknown,
  job: StoredJob,
  now: Temporal.Instant,
  random: () => number,
): JobOutcome | undefined {
  const known = isKeelwerkError(error)
    ? error
    : errors.internal(error instanceof Error ? error.message : 'The job failed.', { cause: error });
  if (known.code === 'core.job_lease_lost') return undefined;
  const wire = { ...toWire(known, 'public'), requestId: '' };
  const delay = retriable(known) ? retryDelay(job.retry, job.attempt.attempt, random) : undefined;
  const expired =
    job.retry?.giveUpAfter !== undefined &&
    Temporal.Instant.compare(
      now,
      job.createdAt.add({ milliseconds: durationMs(job.retry.giveUpAfter) }),
    ) >= 0;
  if (delay !== undefined && !expired) {
    const wait = Math.max(delay, Math.ceil((known.retryAfter ?? 0) * 1000));
    return { kind: 'retry', at: now.add({ milliseconds: wait }), error: wire };
  }
  return job.deadLetter === undefined
    ? { kind: 'failed', error: wire }
    : { kind: 'dead', error: wire };
}
