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
  /** Resolves by the deadline; unfinished work is left to its lease. */
  stop(deadline: Temporal.Instant): Promise<void>;
}
