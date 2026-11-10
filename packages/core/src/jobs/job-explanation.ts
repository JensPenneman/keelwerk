import type { WireError } from '../errors/wire-error.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';

/** Why a job waits (section 9.5.1, S-156; `paused` from S-121). */
export type JobExplanation =
  | { readonly state: 'scheduled'; readonly dueAt: Temporal.Instant }
  | {
      readonly state: 'available';
      readonly waitingFor: 'cap' | 'group' | 'rate' | 'capability' | 'revision' | 'slot' | 'paused';
      readonly detail: string;
    }
  | { readonly state: 'waiting'; readonly behindKey: string }
  | { readonly state: 'running'; readonly worker: string; readonly leaseUntil: Temporal.Instant }
  | { readonly state: 'dead'; readonly error: WireError }
  /** In history only; the outcome is absent once history lost it. */
  | { readonly state: 'gone'; readonly outcome?: Exclude<JobOutcome['kind'], 'retry'> };
