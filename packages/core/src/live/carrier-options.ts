/** What a carrier needs to frame a stream on one connection (15.4.11). */
export interface CarrierOptions {
  readonly heartbeatMs: number;
  readonly maxBufferedItems: number;
  readonly maxBufferedBytes: number;
  readonly maxDurationMs: number;
}
