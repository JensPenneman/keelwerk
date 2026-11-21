import type { Clock, Invoker, Logger, Scope, VersionProjection } from '@keelwerk/core';
import type { TrpcConfig } from '../trpc-config.ts';
import type { TrpcVersionMount } from './trpc-version-mount.ts';

/** What the request handler of one app's mount works from. */
export interface TrpcHandlerDeps {
  /** The router of each API version, built at mount. */
  readonly versions: VersionProjection<TrpcVersionMount>;
  readonly invoker: Invoker;
  readonly config: (scope: Scope) => TrpcConfig;
  readonly transformer: 'superjson' | 'json';
  readonly log: Logger;
  /** The runtime runs in development: the `development` error audience. */
  readonly development: boolean;
  /** The runtime's clock, for cookie lifetimes; absent: the system clock. */
  readonly clock?: Clock;
  /**
   * Aborted by the mount's close: every open HTTP stream ends and a call that starts after it is
   * refused `unavailable`, over HTTP and over a socket. A stream already open on a socket is ended by
   * the host's own stop, not by this signal.
   */
  readonly closing: AbortSignal;
  /** The calls in flight that the mount's close waits for: every HTTP request and every query over a socket. */
  readonly running: Set<Promise<unknown>>;
}
