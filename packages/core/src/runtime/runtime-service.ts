import type { ProcessRole } from './process-role.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';

/**
 * A kernel or event service started after `start` and stopped at `stop` in processes whose role is
 * listed (S-154): 'core.workers', 'core.schedules', 'core.marks', 'events.consumers',
 * 'events.retention', 'events.erasure'.
 */
export interface RuntimeService {
  readonly id: string;
  readonly roles: readonly ProcessRole[];
  start(context: RuntimeServiceContext): Promise<void>;
  /**
   * Stops the service's work: what runs is given until `deadline` to finish, then it is aborted and
   * what the service holds in the store is given back, so `stop` can resolve a little after the
   * deadline. The runtime's stop waits for it only as `stopPhase` says.
   */
  stop(deadline: Temporal.Instant): Promise<void>;
  /**
   * The stop gave up waiting for `stop` at its own deadline and is about to close the adapters:
   * ends the waits of `stop` and gives back what the service still holds in the store. Resolves
   * when that is done; a service that holds nothing in the store leaves it out.
   */
  expire?(): Promise<void>;
}
