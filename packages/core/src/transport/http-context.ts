import type { Carrier } from '../invoker/carrier.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';

export interface HttpContext {
  /** Scope and principal, resolved once for this request (section 16.3.4). */
  readonly session: InvocationSession;
  /** As filled by the host, transport 'http'; credentials included, for resolvers only. */
  readonly carrier: Carrier;
  /** UUIDv7, echoed as `x-request-id`. */
  readonly requestId: string;
  readonly traceparent?: string;
  /** Aborts when the client disconnects. */
  readonly signal: AbortSignal;
  /** After any tenant path prefix consumed by scope resolution. */
  readonly basePath: string;
}
