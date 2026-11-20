/** The host bounds an ending case boots its own deployment with. */
export interface StreamEndingBounds {
  /** `liveSocket.revalidateMs`: the session check of sockets and HTTP streams. */
  readonly revalidateMs: number;
  /** `live.maxDurationMs`. */
  readonly maxDurationMs: number;
  /** `live.maxStreams`: the open streams of the whole host. */
  readonly maxStreams: number;
}
