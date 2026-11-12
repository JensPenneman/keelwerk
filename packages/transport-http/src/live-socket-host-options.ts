/**
 * The bounds of `keelwerk.live.v1` sockets (15.4.5, 15.4.7, 15.4.10). The write queue, the stall bound
 * and the longest life are `live`'s (`maxBufferedBytes`, `stallMs`, `maxDurationMs`); a socket counts
 * as one stream of `live`'s per principal, tenant and process bounds.
 */
export interface LiveSocketHostOptions {
  /** A ping after this long without one; default 30,000. */
  readonly heartbeatMs?: number;
  /** No pong by then terminates the socket; default 10,000. */
  readonly pongTimeoutMs?: number;
  /** No hello by then closes the socket with 4000; default 10,000. */
  readonly helloTimeoutMs?: number;
  /** Subscriptions open on one socket; default 100 (15.4.10). */
  readonly maxSubscriptionsPerSocket?: number;
  /** The largest frame and message a socket takes (ws `maxPayload`, close 1009); default: the host's `maxBodyBytes`. */
  readonly maxMessageBytes?: number;
  /** Messages a socket may send in one window; more closes it with 4429; default 200. */
  readonly maxMessagesPerWindow?: number;
  /** The fixed window of the message rate, on the runtime's clock; default 10,000. */
  readonly messageWindowMs?: number;
  /** Invokes queued or running on one socket; more answer `core.quota_exceeded` unrun; default 32. */
  readonly maxPendingInvokes?: number;
  /** The socket's own session check; default 60,000. */
  readonly revalidateMs?: number;
}
