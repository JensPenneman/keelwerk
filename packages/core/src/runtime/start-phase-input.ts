import type { RestoreHold } from '../control/restore-hold.ts';
import type { FlagProvider } from '../flags/flag-provider.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Composed } from './compose-phase.ts';
import type { Connected } from './connected.ts';
import type { Migrated } from './migrate-phase.ts';
import type { RuntimeOptions } from './runtime-options.ts';
import type { ServedApp } from './served-app.ts';
import type { ServiceGate } from './service-gate.ts';

/** What `start` runs on: the earlier phases' results, the served apps and the runtime's invoker and clock. */
export interface StartPhaseInput {
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly options: RuntimeOptions;
  /** The composed apps and the sorted infrastructure (`ledgers`, `eventWorkers`) of `compose`. */
  readonly composed: Composed;
  /** The served apps by id, as `RuntimeServiceContext.apps` takes them (S-154). */
  readonly apps: ReadonlyMap<string, ServedApp>;
  /** The draining invoker `Runtime.invoker` answers; action jobs run through it (9.5.6). */
  readonly invoker: Invoker;
  /** The runtime clock (plan rule 13). */
  readonly clock: Clock;
  /** The ordered flag providers of the process (the invoker's), which the workers read a hold's flags through. */
  readonly flagProviders?: readonly FlagProvider[];
  /** Closed by a service that finds a restore under the running process; absent in a bare start. */
  readonly gate?: ServiceGate;
  /** The tenants a restore holds: the workers give their effect and deadline jobs back. */
  readonly restoreHold?: RestoreHold;
}
