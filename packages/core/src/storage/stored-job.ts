import type { JobAttempt } from './job-attempt.ts';
import type { JobId } from './job-id.ts';
import type { StoredJobSpec } from './stored-job-spec.ts';

/** A taken job: its row, with the attempt the worker now holds (section 14.3.9). */
export interface StoredJob extends StoredJobSpec {
  readonly id: JobId;
  readonly runAt: Temporal.Instant;
  readonly attempt: JobAttempt;
  /**
   * Set when the job's leases were lost three times in a row (9.5.4) and the job is an action job
   * whose run carries a command id, so a receipt may hang on it. The store never ends such a job
   * for lost leases: it keeps it takeable however often they are lost, and its taker ends it as a
   * dead letter without running it, in the unit that also fails its receipt (D7).
   */
  readonly leasesExhausted?: true;
}
