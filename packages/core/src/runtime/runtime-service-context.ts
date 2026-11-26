import type { Invoker } from '../invoker/invoker.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { LiveTimers } from '../live/live-timers.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { Connected } from './connected.ts';
import type { ServedApp } from './served-app.ts';

/** What a runtime service receives at start (S-154). */
export interface RuntimeServiceContext
  extends Pick<Connected, 'build' | 'control' | 'keys' | 'log' | 'placements'> {
  /**
   * Aborts when the process stops or leaves service (a restore was found under it, 14.7.6): a
   * service stops taking and starting work then and leaves what it holds to its lease. The mark
   * recorder, which records the evidence of the restore, gets one that aborts at the stop only.
   */
  readonly signal: AbortSignal;
  /** The served apps by id: registries for action jobs and reactions. */
  readonly apps: ReadonlyMap<string, ServedApp>;
  /** Action jobs run through it (section 9.5.6). */
  readonly invoker: Invoker;
  readonly queue: JobQueue;
  /** The namespaces of the process, as the kernel queue sweeps them (the control namespace last). */
  readonly namespaces: readonly QueueSource[];
  /** The scope directory over the control store: a scope id to its backend or tenant. */
  readonly directory: ScopeLookup;
  /**
   * The same directory reading archived backends and tenants too: for the workers that finish what
   * an archived scope still owes (the erasure, retention), never for a request or a consumer.
   */
  readonly archivedDirectory: ScopeLookup;
  /** `RuntimeInfrastructure.ledgers`. */
  readonly ledgers: readonly LedgerSink[];
  /** The process's quota cache: a service that enqueues asks it for fresh limits before the unit that enqueues; absent in a bare start. */
  readonly quotas?: QuotaLimits;
  /** The runtime clock; every timer of a service reads it (plan rule 13). */
  readonly clock: Clock;
  /**
   * The waits of a service on that clock: `RuntimeOptions.timers`, else timers on `clock`. A
   * service that waits between passes or for a deadline waits here, not on a wall-clock timer, so
   * a test that pins the timers decides when a wait ends.
   */
  readonly timers: LiveTimers;
}
