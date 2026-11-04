import type { FlagRead } from '../events/flag-read.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { Position } from '../storage/position.ts';

/** What a query answered, with what the snapshot saw. */
export interface RunReadResult {
  /** The handler's output, before the shape stage. */
  readonly output: unknown;
  /** The highest committed position of the scope, read before the handler ran; `null` for a scope that never appended. */
  readonly head: Position | null;
  /** The position each load saw, in the order the loads were answered. */
  readonly reads: readonly RecordedRead[];
  /** The flags the query read. */
  readonly flags: readonly FlagRead[];
}
