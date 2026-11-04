import type { SurfaceAction, SurfaceEntity } from '@keelwerk/core';

/** How a route turns a request into an input (section 16.5.2). */
export type RouteMode =
  /** `GET /{c}/{id}`: the id from the path, `fields` and `asOf` from the query. */
  | 'get-one'
  /** `GET /{c}/{id}/history`. */
  | 'history'
  /** Scalars from the query string, `filter` as JSON, `sort` in the compact form. */
  | 'query-string'
  /** The JSON body is the input. */
  | 'body'
  /** An instance operation: `id` from the path, `ifVersion` from `If-Match`, the rest from the body. */
  | 'instance'
  /** Subscriptions and `watch`: need the live module (S-62). */
  | 'stream';

/** One method and path of the route table (section 16.5.1). */
export interface RestRoute {
  readonly method: string;
  /** Router pattern with `:id` for the row id; relative to the base path unless `absolute`. */
  readonly path: string;
  /** A `rest.path` hint that starts with '/': relative to the host root (section 16.5.8). */
  readonly absolute: boolean;
  readonly mode: RouteMode;
  readonly action: SurfaceAction;
  /** The entity of an entity-mounted action. */
  readonly entity?: SurfaceEntity;
  /** 201 with `Location` instead of 200. */
  readonly creates: boolean;
}
