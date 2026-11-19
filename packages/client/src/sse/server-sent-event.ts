/** One event of a `text/event-stream` body (WHATWG HTML 9.2.6). */
export interface ServerSentEvent {
  /** `message` when the block names none. */
  readonly event: string;
  /** The data lines joined with `\n`. */
  readonly data: string;
  /** The block's `id` field; absent when it has none, `''` for a bare `id:`. */
  readonly id?: string;
}
