import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { JobAttempt } from '../storage/job-attempt.ts';
import type { Scope } from '../storage/scope.ts';

/** What a worker's invocation carries instead of credentials (S-122): the job's scope and principal reference. */
export interface JobCarrier {
  readonly scope: Scope;
  /** The id of the namespace the job was taken from: the scope must resolve to data there. */
  readonly namespace: string;
  readonly principal: PrincipalRef;
  /**
   * The transport the gate judges the job under: the transport its accepted receipt records, or
   * null (unknown) when it has none, where every transport-scoped deny rule applies.
   */
  readonly transport: string | null;
  readonly attempt: JobAttempt;
  /** The fencing id: the process id. */
  readonly worker: string;
  /** `Job.signal`: aborts at expireInSeconds (`core.timeout`) or a lost lease (`core.job_lease_lost`). */
  readonly signal: AbortSignal;
}
