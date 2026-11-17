/** The live bounds of the runner's host that cases depend on (15.4.10). */
export interface TransportBounds {
  /** Streams of one principal; for anonymous callers, of one client address (SSE, sockets, socket subscriptions). */
  readonly maxStreamsPerPrincipal: number;
  /** Subscriptions open on one socket. */
  readonly maxSubscriptionsPerSocket: number;
}
