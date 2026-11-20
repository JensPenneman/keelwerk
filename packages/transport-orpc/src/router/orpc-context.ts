import type { ApiSurface, Carrier, InvocationSession, Invoker, Logger } from '@keelwerk/core';
import type { OrpcAnswer } from './orpc-answer.ts';

/**
 * The initial context of every oRPC call. It is assignable to oRPC's `Context`, so a router built
 * against it runs under the handlers of this package.
 */
export interface OrpcContext {
  readonly session: InvocationSession;
  readonly carrier: Carrier;
  readonly requestId: string;
  readonly traceparent?: string;
  /** Aborts when the client disconnects. */
  readonly signal: AbortSignal;
  readonly invoker: Invoker;
  /** The surface of the request's API version. */
  readonly surface: ApiSurface;
  /** The RPC handler's serialiser; the OpenAPI handler is always 'json'. */
  readonly wire: 'orpc' | 'json';
  /** The runtime runs in development: the `development` error audience. */
  readonly development: boolean;
  readonly log: Logger;
  /** The runtime's clock reading for cookie lifetimes; absent: the system clock. */
  readonly now?: Temporal.Instant;
  /** Set-Cookie values the cookie hint produced, appended to the response. */
  readonly setCookies: string[];
  /** What the procedure tells the handler about the response. */
  readonly answer: OrpcAnswer;
}
