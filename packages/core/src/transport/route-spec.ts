/** What a transport registers through `TransportHost.route` (section 16.3.3). */
export interface RouteSpec {
  readonly app: string;
  readonly transport: string;
  /** Starts with `/`; prefixes of one app must not overlap. */
  readonly prefix: string;
  /**
   * Which requests of this route open a long-lived response (a stream). For each request it accepts,
   * the host applies the stream origin check (16.4.10) and holds a stream slot (15.4.10) until the body
   * ends, and never compresses the response. Called once per request that reaches the origin check
   * (not for a CORS preflight; also for a WebSocket upgrade under the prefix), after the session opened
   * and before the handler runs, with the request as received (method, URL and headers; its body is
   * already read and not available) and the path relative to the mount, as `HttpContext.path`. Must be
   * pure and synchronous; a throw answers 500 `core.internal` and the handler does not run.
   * Absent: `asksForEventStream(request)`, so server-sent events need no declaration.
   * A route that answers a stream (see the host's stream rule) to a request its predicate refused
   * is answered 500 `core.internal` and its body is cancelled.
   */
  readonly streams?: (request: Request, path: string) => boolean;
}
