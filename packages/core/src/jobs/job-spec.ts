import type { ActorRef } from '../principals/actor-ref.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { JobGroup } from './job-group.ts';
import type { JobRetry } from './job-retry.ts';
import type { JobRun } from './job-run.ts';

/** What the kernel enqueues (section 9.5.1). */
export interface JobSpec {
  /** 'reactions', 'commands', 'timers', 'schedules', 'effects' or a module queue. */
  readonly queue: string;
  readonly run: JobRun;
  readonly scope: Scope;
  /** Re-resolved when the job runs (section 7.4). */
  readonly principal: PrincipalRef;
  readonly causation: {
    readonly eventId?: string;
    readonly commandId?: string;
    readonly actor?: ActorRef;
  };
  /** The enqueuer's build (section 19.2). */
  readonly build: { readonly id: string; readonly revision: number };
  /** External callers: the input as sent, at this API version. */
  readonly apiVersion?: string;
  readonly runAt?: Temporal.Instant;
  /** Set by module code, never by input. */
  readonly priority?: 'high' | 'normal' | 'low';
  /** Fair-share units; default 1. */
  readonly cost?: number;
  readonly key?: {
    readonly value: string;
    readonly onConflict: 'keep' | 'replace' | 'coalesce';
  };
  readonly ordering?: 'none' | 'fifo-per-key';
  readonly group?: JobGroup;
  /** Effect jobs: the executor's (section 21.2). */
  readonly capability?: readonly string[];
  readonly retry?: JobRetry;
  /** Lease renewal, default 10; a lease lasts three. */
  readonly heartbeatSeconds?: number;
  /** The longest one attempt may run. */
  readonly expireInSeconds?: number;
  readonly deadLetter?: string;
}
