/** What the host's server-sent event streams are bounded by (15.4.5, 15.4.10). */
export interface SseHostOptions {
  /** Milliseconds of silence before a `: ping` comment; default 15,000 (15.4.5). */
  readonly heartbeatMs?: number;
  /** The longest a stream lives, in milliseconds; default 86,400,000 (24 hours). */
  readonly maxDurationMs?: number;
  /** Bytes one connection queues for its client; default 1 MiB. */
  readonly maxBufferedBytes?: number;
  /** A write that waits this long for the client closes the connection; default 30,000. */
  readonly stallMs?: number;
  /** Open streams: per principal 20, per tenant 1,000, per process 10,000 (15.4.10). */
  readonly maxStreamsPerPrincipal?: number;
  readonly maxStreamsPerTenant?: number;
  /** Of a tenant's streams, those of anonymous callers together; default 200. */
  readonly maxAnonymousStreamsPerTenant?: number;
  readonly maxStreams?: number;
}
