import type { Carrier } from '../invoker/carrier.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { SurfaceAction } from '../surface/surface-action.ts';

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
  /**
   * Answers this request with a subscription's wire frames as a server-sent event stream on the
   * app's `sse` live carrier (15.4.6): the retry hint, the welcome with `surfaceHash`, the action's
   * deprecation notices, heartbeats, the maximum duration, stalls and `going_away` at stop are the
   * host's. Present only when the request asks for `text/event-stream` and the app has an `sse`
   * carrier; the host holds the stream slot of the request. The carrier calls the iterator's
   * `return()` when the connection ends.
   */
  readonly serveStream?: (
    frames: AsyncIterable<LiveFrame<unknown>>,
    options: { readonly action: SurfaceAction; readonly surfaceHash: string },
  ) => Response;
}
