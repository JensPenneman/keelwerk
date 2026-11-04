import type { JobAttempt } from './job-attempt.ts';
import type { JobId } from './job-id.ts';
import type { StoredJobSpec } from './stored-job-spec.ts';

/** A taken job: its row, with the attempt the worker now holds (section 14.3.9). */
export interface StoredJob extends StoredJobSpec {
  readonly id: JobId;
  readonly runAt: Temporal.Instant;
  readonly attempt: JobAttempt;
}
