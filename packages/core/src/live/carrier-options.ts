import type { WireError } from '../errors/wire-error.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LiveTimers } from './live-timers.ts';

/** What a carrier needs to frame a stream on one connection (15.4.11). */
export interface CarrierOptions {
  readonly heartbeatMs: number;
  readonly maxBufferedItems: number;
  readonly maxBufferedBytes: number;
  readonly maxDurationMs: number;
  /** The clock the carrier's bounds are read on; absent: the system clock. */
  readonly clock?: Clock;
  /** The waits of the carrier (heartbeat, maximum duration) on that clock; absent: `liveTimersOf(clock)`. */
  readonly timers?: LiveTimers;
  /** The id a multiplexing carrier frames the stream under (15.4.7 `subscribe.id`); the websocket carrier refuses to serve without it. */
  readonly subscriptionId?: string;
  /** What the opening frame says (15.4.6 `welcome`, 15.4.7 welcome). */
  readonly welcome?: {
    readonly apiVersion: string;
    readonly surfaceHash: string;
    readonly protocol: number;
  };
  /** The error that ends a stream as the host renders it (audience, request id); absent: public audience, empty request id. */
  wireError?(error: unknown): WireError;
}
