import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';

/** What the runtime gives a live hub when it opens it for one app: its time source and a logger bound to the app. */
export interface LiveHubServices {
  readonly clock: Clock;
  readonly log: Logger;
}
