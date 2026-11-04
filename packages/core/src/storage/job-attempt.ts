import type { JobId } from './job-id.ts';

/** One attempt of a job: renewal and completion are conditional on (worker, attempt). */
export interface JobAttempt {
  readonly jobId: JobId;
  readonly attempt: number;
}
