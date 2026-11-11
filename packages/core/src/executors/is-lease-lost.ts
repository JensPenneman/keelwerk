import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';

/** Whether an error is the end of an attempt that lost its lease: nothing may be completed for it. */
export function isLeaseLost(error: unknown): boolean {
  return isKeelwerkError(error) && error.code === 'core.job_lease_lost';
}
