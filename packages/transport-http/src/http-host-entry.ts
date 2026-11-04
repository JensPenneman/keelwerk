import type { Contracts, InfrastructureEntry } from '@keelwerk/core';
import type { HttpHostDeps } from './http-host-deps.ts';
import type { HttpHostInstance } from './http-host-instance.ts';
import type { HttpHostOptions } from './http-host-options.ts';

/** The infrastructure entry that provides `contracts.httpHost`. */
export interface HttpHostEntry extends InfrastructureEntry {
  readonly kind: 'httpHost';
  readonly provides: readonly [Contracts['httpHost']];
  readonly options: HttpHostOptions;
  /** Builds the host once the runtime has its invoker. */
  create(deps: HttpHostDeps): HttpHostInstance;
}
