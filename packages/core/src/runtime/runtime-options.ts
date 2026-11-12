import type { RowEnvironment } from '../authorization/row-environment.ts';
import type { LiveTimers } from '../live/live-timers.ts';
import type { Logger } from '../observability/logger.ts';
import type { ProcessRole } from './process-role.ts';
import type { WorkOptions } from './work-options.ts';

export interface RuntimeOptions {
  readonly role: ProcessRole;
  /** False: connect and migrate without listeners (the CLI's project mode, tests). */
  readonly listen: boolean;
  /** Default: every app of the deployment. */
  readonly apps?: readonly string[];
  /** Default: the core's no-op logger (section 11). */
  readonly logger?: Logger;
  /**
   * Development plans and applies the schema difference at `migrate` and shows internal errors;
   * production verifies the history against the files and refuses on drift (section 3.3).
   * Default: development or test when `env.NODE_ENV` says so, else production (change note, WP-43).
   */
  readonly environment?: RowEnvironment;
  /**
   * The process environment, which only the deployment file and the CLI read: `env()` references,
   * the default secret provider and `NODE_ENV` resolve against it; default: empty (change note, WP-43).
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Tests: a fixed or stepped clock. */
  readonly clock?: { now(): Temporal.Instant };
  /** The waits of live carriers and of the usage flusher (heartbeat, maximum duration, the minute between flushes); default: timers on the runtime's clock (change note, WP-94). */
  readonly timers?: LiveTimers;
  /** What a process with the `work` role works: slots, capabilities and the drain (section 21.1). */
  readonly work?: WorkOptions;
}
