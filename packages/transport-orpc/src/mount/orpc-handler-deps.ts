import type { Clock, Invoker, Logger, VersionProjection } from '@keelwerk/core';
import type { OrpcVersionMount } from './orpc-version-mount.ts';

/** What the request handlers of one app's mount work from. */
export interface OrpcHandlerDeps {
  /** The router and handlers of each API version, built at mount. */
  readonly versions: VersionProjection<OrpcVersionMount>;
  readonly invoker: Invoker;
  readonly log: Logger;
  /** The runtime runs in development: the `development` error audience. */
  readonly development: boolean;
  /** The RPC handler's serialiser; the OpenAPI handler is always plain JSON. */
  readonly serializer: 'orpc' | 'json';
  /** The runtime's clock, for cookie lifetimes and deprecation dates; absent: the system clock. */
  readonly clock?: Clock;
}
