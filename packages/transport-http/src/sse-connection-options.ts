import type { Clock, LiveTimers } from '@keelwerk/core';

/** What one server-sent event connection is made with. */
export interface SseConnectionOptions {
  /** The validated `Last-Event-ID` of the request, or null. */
  readonly lastEventId: string | null;
  readonly maxBufferedBytes: number;
  readonly stallMs: number;
  /** The clock and the waits the stall bound runs on. */
  readonly clock: Clock;
  readonly timers: LiveTimers;
  /** Aborted when the client goes away, the connection stalls, or the host says goodbye: it ends the subscription. */
  readonly abort: AbortController;
  /** Destroys the transport of a connection that stalled, where the host has one. */
  readonly destroy?: () => void;
}
