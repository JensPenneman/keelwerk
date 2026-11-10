import type { Invoker } from '../invoker/invoker.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { Telemetry } from '../observability/telemetry.ts';
import type { Scope } from '../storage/scope.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { TransportHost } from './transport-host.ts';

export interface MountContext<Config> {
  readonly app: string;
  /** The deployment id (S-69): the scope id of deployment-scope rows, which receipt ids of deployment-scope commands carry. */
  readonly deploymentId: string;
  readonly surface: ApiSurface;
  readonly invoker: Invoker;
  readonly host: TransportHost;
  /** Per-backend (and per-tenant) values of the module's `config`. */
  readonly config: (scope: Scope) => Config;
  readonly telemetry: Telemetry;
  readonly log: Logger;
  /** Set by the runtime in development: a transport picks the `development` error audience and enables its docs page from it. */
  readonly development?: boolean;
  /** The runtime's clock: transports read the time of cookie lifetimes from it; absent: the system clock (change note, followups). */
  readonly clock?: Clock;
}
