import type {
  Carrier,
  Clock,
  InvocationSession,
  LiveCarrier,
  LiveTimers,
  Logger,
} from '@keelwerk/core';
import type { EndpointCall } from './endpoint-call.ts';
import type { OpenLiveSocket } from './open-live-socket.ts';

/** The state of one `keelwerk.live.v1` socket: host-internal, changed by `serveLiveSocket` and the parts it runs only. */
export interface LiveSocketState {
  /** The upgrade request's call. */
  readonly upgrade: EndpointCall;
  readonly open: OpenLiveSocket;
  readonly carrier: LiveCarrier;
  /** Replaced by the hello and by each successful revalidation. */
  session: InvocationSession;
  /** The hello's carrier: what invocations are given. */
  socketCarrier: Carrier;
  /** The socket's stream slot. */
  release: () => void;
  /** The hello's trace context, when it sent a well-formed one. */
  traceparent?: string;
  readonly subscriptions: Map<
    string,
    { readonly abort: AbortController; readonly done: Promise<void> }
  >;
  /** The head refs of deprecated actions this socket was told of. */
  readonly noticedActions: Set<string>;
  pendingInvokes: number;
  /** The bytes of the texts of the invokes queued or running. */
  pendingInvokeBytes: number;
  /** Aborted when the socket ends: every wait and listener hangs on it. */
  readonly everything: AbortController;
  readonly clock: Clock;
  readonly timers: LiveTimers;
  /** Accept plus the host's longest life of a stream. */
  readonly deadline: Temporal.Instant;
  /** A child logger with the connection id. */
  readonly log: Logger;
  /** The socket's own session check, set once the socket's life starts. */
  keeper?: { check(): Promise<boolean> };
}
