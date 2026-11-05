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
  /**
   * The request path relative to the mount: the host resolved the tenant and stripped the tenant
   * prefix and the mount's prefix (`/` when nothing is left). Transports never strip.
   */
  readonly path: string;
  /** The prefix the host stripped (tenant prefix, then the mount's prefix; empty for a mount at `/`), for links. */
  readonly basePath: string;
}
