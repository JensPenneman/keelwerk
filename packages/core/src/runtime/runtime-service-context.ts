import type { Invoker } from '../invoker/invoker.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { Connected } from './connected.ts';
import type { ServedApp } from './served-app.ts';

/** What a runtime service receives at start (S-154). */
export interface RuntimeServiceContext
  extends Pick<Connected, 'control' | 'keys' | 'log' | 'placements' | 'signal'> {
  /** The served apps by id: registries for action jobs and reactions. */
  readonly apps: ReadonlyMap<string, ServedApp>;
  /** Action jobs run through it (section 9.5.6). */
  readonly invoker: Invoker;
  readonly queue: JobQueue;
  /** The namespaces of the process, as the kernel queue sweeps them (the control namespace last). */
  readonly namespaces: readonly QueueSource[];
  /** The scope directory over the control store: a scope id to its backend or tenant. */
  readonly directory: ScopeLookup;
  /** `RuntimeInfrastructure.ledgers`. */
  readonly ledgers: readonly LedgerSink[];
  /** The runtime clock; every timer of a service reads it (plan rule 13). */
  readonly clock: Clock;
}
