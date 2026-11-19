import type { HttpHandler, RouteSpec } from '@keelwerk/core';

/** One transport's handler under a prefix. */
export interface Mount {
  readonly transport: string;
  readonly prefix: string;
  readonly handler: HttpHandler;
  /** The route's stream predicate; absent: server-sent events (`asksForEventStream`). */
  readonly streams?: NonNullable<RouteSpec['streams']>;
}

/** The mounts of one app: longest prefix wins, overlapping prefixes are a `routeConflict`. */
export interface MountTable {
  add(spec: Pick<RouteSpec, 'transport' | 'prefix' | 'streams'>, handler: HttpHandler): void;
  match(path: string): Mount | undefined;
}
