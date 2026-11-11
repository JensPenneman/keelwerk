import type { Clock, Invoker, Logger, Scope, VersionProjection } from '@keelwerk/core';
import type { RestConfig } from './rest-config.ts';
import type { RestStaticOptions } from './rest-static-options.ts';
import type { RestVersionMount } from './rest-version-mount.ts';

/** What the request handler of one app's mount works from. */
export interface RestHandlerDeps {
  readonly app: string;
  /** The deployment id (S-69), which deployment-scope receipt ids carry. */
  readonly deploymentId: string;
  /** The surface, route table, problem pages and OpenAPI documents of each API version, built at first use. */
  readonly versions: VersionProjection<RestVersionMount>;
  readonly invoker: Invoker;
  readonly options: RestStaticOptions;
  /** The handler serves a host-root mount of a `rest.path` hint: the request path is the whole route. */
  readonly root?: true;
  readonly config: (scope: Scope) => RestConfig;
  readonly log: Logger;
  /** The runtime runs in development: the `development` error audience and the docs page. */
  readonly development: boolean;
  /** The runtime's clock, for cookie lifetimes; absent: the system clock. */
  readonly clock?: Clock;
}
