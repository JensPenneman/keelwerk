/** The live bounds of the runner's host that cases depend on (15.4.10). */
export interface TransportBounds {
  /** Streams of one principal; for anonymous callers, of one client address (SSE, sockets, socket subscriptions). */
  readonly maxStreamsPerPrincipal: number;
  /** Subscriptions open on one socket. */
  readonly maxSubscriptionsPerSocket: number;
  /** The ping every this long on a live socket; default 30,000 (the pong bound follows it on the same clock). */
  readonly heartbeatMs: number;
  /** The socket's own session check every this long; default 60,000. */
  readonly revalidateMs: number;
}
