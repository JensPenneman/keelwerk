import type { JobRetry } from '../jobs/job-retry.ts';
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
  /** The retry policy of the job: the receipt of a job that crosses scopes outlives its horizon (`receiptWindowMs`). */
  readonly retry?: JobRetry;
  /** The event that caused the job (a continuation's settled record, a reaction's event): the `causationId` of the events its command writes. */
  readonly causationId?: string;
  /**
   * The key of the job (a reaction job: `<reaction id>:<sha256 of the part>`, never the part). A
   * process computes its instance key again from the event and refuses a job whose key is not the
   * hash of it, so it writes only to the instance whose lane the job was queued in.
   */
  readonly key?: string;
  /** Set when the job runs the reaction its `action` names: the invoker locates a reaction, and the write path decides it with the event it reads (7.7). */
  readonly reaction?: true;
  /** The fencing id: the process id. */
  readonly worker: string;
  /** `Job.signal`: aborts at expireInSeconds (`core.timeout`) or a lost lease (`core.job_lease_lost`). */
  readonly signal: AbortSignal;
}
