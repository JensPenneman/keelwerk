import type { Invoker } from '../invoker/invoker.ts';
import type { Logger } from '../observability/logger.ts';
import type { Telemetry } from '../observability/telemetry.ts';
import type { Scope } from '../storage/scope.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { TransportHost } from './transport-host.ts';

export interface MountContext<Config> {
  readonly app: string;
  readonly surface: ApiSurface;
  readonly invoker: Invoker;
  readonly host: TransportHost;
  /** Per-backend (and per-tenant) values of the module's `config`. */
  readonly config: (scope: Scope) => Config;
  readonly telemetry: Telemetry;
  readonly log: Logger;
  /** Set by the runtime in development: a transport picks the `development` error audience and enables its docs page from it. */
  readonly development?: boolean;
}
