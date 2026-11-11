import type { WireError } from '../errors/wire-error.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { Position } from './position.ts';

/** A row of `kw_parked` (section 15.2.3). */
export interface ParkedStream {
  readonly scopeId: string;
  readonly stream: StreamRef;
  /** The first event of the stream not handled: the replay starts here. */
  readonly from: Position;
  /** Parkings, counted by the store: 1 at insert, one more per park while the row exists. */
  readonly attempts: number;
  /**
   * Kind and code only: the store keeps nothing else of an error, since its message can repeat a
   * personal value. The members the type requires besides them are filled with an empty message,
   * `retryable: false` and an empty `requestId`.
   */
  readonly lastError: WireError;
  readonly parkedAt: Temporal.Instant;
}
