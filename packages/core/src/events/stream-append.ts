import type { NewEvent } from './new-event.ts';
import type { StreamRef } from './stream-ref.ts';

/** Events appended to one stream in one batch. */
export interface StreamAppend {
  readonly stream: StreamRef;
  /** 0 creates the stream. */
  readonly expectedVersion: number;
  readonly partition: string | null;
  readonly events: readonly NewEvent[];
}
