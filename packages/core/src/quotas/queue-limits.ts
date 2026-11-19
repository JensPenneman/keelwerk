/** The limits of one queue of the deployment for one scope. */
export interface QueueLimits {
  readonly running: number;
  readonly queued: number;
  readonly weight: number;
}
