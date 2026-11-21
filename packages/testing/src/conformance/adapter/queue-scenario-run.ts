import type { JobAttempt } from '@keelwerk/core';

/**
 * One attempt a scenario handler started. A completion that answers false throws inside the unit, so
 * the unit rolls back; the handler then ends `fenced` and resolves (the fetcher completes nothing).
 * `refused` is an attempt outside `holdInUnit` whose unit failed after its signal had aborted (a lost
 * lease or a drain): the adapter refuses the unit and nothing was written. `dropped` is an attempt
 * aborted by a lost lease or a drain while it waited inside its unit.
 */
export interface QueueScenarioRun {
  readonly worker: string;
  readonly input: number;
  readonly attempt: number;
  /** The attempt as the store knows it, for a direct call of the job store. */
  readonly token: JobAttempt;
  readonly scopeId: string;
  end: 'running' | 'completed' | 'fenced' | 'refused' | 'failed' | 'dropped';
  /** The job signal's reason once it aborted (core.job_lease_lost, core.timeout, core.unavailable at a drain). */
  abortReason: unknown;
}
