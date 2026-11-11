import type {
  Clock,
  Invoker,
  Logger,
  Scope,
  SelectionLimits,
  VersionProjection,
} from '@keelwerk/core';
import type { GraphqlConfig } from '../graphql-config.ts';
import type { GraphqlVersionMount } from './graphql-version-mount.ts';

/** What the request handler of one app's mount works from. */
export interface GraphqlHandlerDeps {
  /** The schema and Yoga instance of each API version, built at mount. */
  readonly versions: VersionProjection<GraphqlVersionMount>;
  readonly invoker: Invoker;
  readonly config: (scope: Scope) => GraphqlConfig;
  /** The limits of the gate (section 16.6.6): the defaults until a backend configures its own. */
  readonly limits: SelectionLimits;
  readonly log: Logger;
  /** The runtime runs in development: the `development` error audience and GraphiQL. */
  readonly development: boolean;
  /** The runtime's clock, for cookie lifetimes; absent: the system clock. */
  readonly clock?: Clock;
}
