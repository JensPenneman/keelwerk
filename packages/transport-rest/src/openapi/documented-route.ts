/** One method and path of an operation (section 16.5.1), derived from a route of the REST route table. */
export interface DocumentedRoute {
  readonly method: 'get' | 'post' | 'patch' | 'delete' | 'query';
  /** The OpenAPI path: `{id}` for the row id; below the servers URL unless `absolute`. */
  readonly path: string;
  /** A `rest.path` hint that starts with '/': the path is relative to the host root (section 16.5.8). */
  readonly absolute: boolean;
  /** Appended to the operation id after the first route of an action. */
  readonly suffix: '' | 'Post' | 'Query';
  /** Where the input travels. */
  readonly carries: 'query-string' | 'body';
  /** The path holds `{id}`. */
  readonly pathId: boolean;
  /** Input members that travel elsewhere on this form: the path, `If-Match`, or nowhere. */
  readonly omit: readonly string[];
  /** A read sent as `POST`, documented as safe and idempotent. */
  readonly safe: boolean;
  /** The success response is a server-sent event stream. */
  readonly stream: boolean;
}
