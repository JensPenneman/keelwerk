import type { TransportProblem } from '@keelwerk/core';
import type { RestRoute } from './rest-route.ts';

/** A route and the path parameters the router read. */
export interface RouteMatch {
  readonly route: RestRoute;
  readonly params: Readonly<Record<string, string>>;
}

/** The routes of one surface, matched by method and path (section 16.5.7: built at `listen`). */
export interface RouteTable {
  /** In registration order: static paths before parameterised ones. */
  readonly routes: readonly RestRoute[];
  /** Host-root paths of `rest.path` hints that start with '/'. */
  readonly absolutePaths: readonly string[];
  readonly problems: readonly TransportProblem[];
  /** `path` is relative to the base path, or absolute for host-root routes. */
  match(method: string, path: string, absolute: boolean): RouteMatch | undefined;
}
