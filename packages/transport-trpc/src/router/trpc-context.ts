import type {
  ApiSurface,
  Carrier,
  InvocationSession,
  Invoker,
  Logger,
  SocketSession,
} from '@keelwerk/core';

/**
 * What every procedure of one request works from. The handler builds it per request and never
 * shares it between requests or principals: the session, the surface of the session's API version
 * and the cookies to set all die with the request.
 */
export interface TrpcContext {
  readonly session: InvocationSession;
  readonly carrier: Carrier;
  readonly requestId: string;
  readonly traceparent?: string | undefined;
  /** The surface of the session's API version. */
  readonly surface: ApiSurface;
  readonly invoker: Invoker;
  readonly transformer: 'superjson' | 'json';
  readonly development: boolean;
  readonly logger: Logger;
  /** The request's clock reading, for cookie lifetimes; absent: the system clock. */
  readonly now?: Temporal.Instant | undefined;
  /**
   * `Idempotency-Key` and `Prefer: respond-async` of a request with one call; a request of several
   * calls that carries either is refused.
   */
  readonly commandId?: string | undefined;
  readonly prefer?: 'async' | undefined;
  /** The host's session of the socket the call runs on; absent over HTTP. */
  readonly socket?: SocketSession | undefined;
  /** Aborted when the mount begins to close: a call that starts over the socket after that is refused. */
  readonly closing?: AbortSignal | undefined;
  /** The mount's calls in flight, which its close waits for; a query over a socket joins it for its life. */
  readonly running?: Set<Promise<unknown>> | undefined;
  /** Filled by the procedures, read by `trpcResponseMeta`. */
  readonly answer: {
    readonly setCookies: string[];
    commandId?: string;
    effects?: readonly string[];
    accepted?: boolean;
  };
}
