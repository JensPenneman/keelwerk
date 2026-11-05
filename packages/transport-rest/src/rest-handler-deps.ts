import type { ApiSurface, Artifact, Invoker, Logger, Scope } from '@keelwerk/core';
import type { RestConfig } from './rest-config.ts';
import type { RestStaticOptions } from './rest-static-options.ts';
import type { RouteTable } from './route-table.ts';

/** What the request handler of one app's mount works from. */
export interface RestHandlerDeps {
  readonly app: string;
  /** The deployment id (S-69), which deployment-scope receipt ids carry. */
  readonly deploymentId: string;
  readonly surface: ApiSurface;
  readonly invoker: Invoker;
  readonly table: RouteTable;
  readonly options: RestStaticOptions;
  /** The handler serves a host-root mount of a `rest.path` hint: the request path is the whole route. */
  readonly root?: true;
  readonly config: (scope: Scope) => RestConfig;
  /** The adapter's artefacts, computed once at mount. */
  readonly artifacts: readonly Artifact[];
  readonly log: Logger;
  /** The runtime runs in development: the `development` error audience and the docs page. */
  readonly development: boolean;
}
