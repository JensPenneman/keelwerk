import type { JobGroup } from '../jobs/job-group.ts';
import type { JobRetry } from '../jobs/job-retry.ts';

/** The executor of an effect (section 7.9.5): the only imperative module code; its job options are the stored shapes of F-08. */
export interface ExecutorEntry {
  /** The reference of the effect it performs: executors are mounted under their effect's key. */
  readonly ref: string;
  readonly module: string;
  readonly effect: string;
  /** The job queue; 'effects' unless the executor names its own. */
  readonly queue: string;
  /** Capabilities a process needs to take the job (section 21.2); empty when none or when `capabilityOf` decides. */
  readonly capability: readonly string[];
  /** A capability computed from the configuration and the input. */
  capabilityOf?(context: { readonly config: unknown; readonly input: unknown }): readonly string[];
  /** Runs in the caller's unit instead of a queue. */
  readonly inline: boolean;
  /** A duration such as '30s'. */
  readonly timeout?: string;
  group?(context: { readonly config: unknown; readonly input: unknown }): JobGroup;
  readonly retry?: JobRetry;
  run(input: unknown, context: unknown): Promise<unknown>;
}
