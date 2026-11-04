import type { Logger } from '../observability/logger.ts';
import type { ProcessRole } from './process-role.ts';

export interface RuntimeOptions {
  readonly role: ProcessRole;
  /** False: connect and migrate without listeners (the CLI's project mode, tests). */
  readonly listen: boolean;
  /** Default: every app of the deployment. */
  readonly apps?: readonly string[];
  /** Default: the core's no-op logger (section 11). */
  readonly logger?: Logger;
  /** Tests: a fixed or stepped clock. */
  readonly clock?: { now(): Temporal.Instant };
}
