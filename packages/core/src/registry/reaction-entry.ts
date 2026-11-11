import type { Shape } from '../fields/shape.ts';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { ActionHandler } from './action-handler.ts';

/** One reaction or process manager (section 7.7); `id` is the key it is mounted under. */
export interface ReactionEntry {
  /** '<module>.<key>': idempotency, checkpoints and dead letters use it. */
  readonly id: string;
  readonly module: string;
  /** Event references, 'accounts.profile.deactivated'. */
  readonly on: readonly string[] | 'all';
  /** With `on: 'all'`: event types never dispatched (S-136). */
  readonly except?: readonly string[];
  readonly timing: 'inline' | 'async';
  /** Async: derives the job key from the event. */
  key?(event: unknown): string;
  readonly ordering: 'none' | 'fifo-per-key';
  readonly coalesce: boolean;
  /** Async: jobs running at once for the reaction and scope (a group). */
  readonly concurrency?: number;
  readonly retry?: JobRetry;
  /** `defineProcess`: carries its own state stream per instance. */
  readonly process: boolean;
  /** Processes: the state before the first event. */
  readonly initial?: unknown;
  /** Processes: the event names of their own stream (S-124). */
  readonly events?: readonly string[];
  /** Processes: the declared shape of each event of the process's stream, by name. */
  readonly eventShapes?: Readonly<Record<string, Shape>>;
  /** Processes: `'instanceKey'` says the personal members of the process's events belong to the data subject the instance key names (Q2). */
  readonly dataSubject?: 'instanceKey';
  readonly react: ActionHandler;
  /** Processes: folds the process's stream into its state. */
  readonly evolve?: ActionHandler;
  /** Modules whose presence activates the reaction (a conditional part). */
  readonly when: readonly string[];
  readonly contributedBy?: string;
}
