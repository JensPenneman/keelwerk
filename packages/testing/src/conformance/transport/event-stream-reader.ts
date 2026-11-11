import type { StreamFrame } from './stream-frame.ts';

/** A server-sent event response read event by event. */
export interface EventStreamReader {
  readonly response: Response;
  /** The next event (comments skipped); undefined once the stream ended; rejects after `ms` (default 10,000). */
  next(ms?: number): Promise<StreamFrame | undefined>;
  /** Every event read until one satisfies `test`, that one included. */
  until(test: (frame: StreamFrame) => boolean, ms?: number): Promise<readonly StreamFrame[]>;
  close(): Promise<void>;
}
