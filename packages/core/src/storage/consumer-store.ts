import type { WireError } from '../errors/wire-error.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { ParkedStream } from './parked-stream.ts';
import type { Position } from './position.ts';

/**
 * Consumer checkpoints, leases and parked streams (sections 14.3.2 and 15.2.3). Joins `Unit` as
 * `consumers`.
 */
export interface ConsumerStore {
  checkpoint(consumer: string, scopeId: string): Promise<Position | null>;
  /**
   * In the unit of the effects; monotonic: the stored position becomes the greater of it and `to`
   * (S-173). A position above the scope's head is a `validation` error, so a consumer cannot end
   * another consumer's delivery by overshooting.
   */
  advance(consumer: string, scopeId: string, to: Position): Promise<void>;
  acquireLease(consumer: string, owner: string, ttlMs: number): Promise<boolean>;
  renewLease(consumer: string, owner: string, ttlMs: number): Promise<boolean>;
  park(consumer: string, stream: StreamRef, from: Position, error: WireError): Promise<void>;
  unpark(consumer: string, stream: StreamRef): Promise<Position | null>;
  /**
   * Moves the start of a parked stream's row forward to `to` (the greater of the stored start and
   * `to`), in the unit's scope, and changes nothing else: the attempts, `parked_at` and the last error
   * stay, so a listing still shows how often and since when the stream is parked. Answers false when
   * the stream is not parked. A chunked replay uses it between chunks.
   */
  advanceParked(consumer: string, stream: StreamRef, to: Position): Promise<boolean>;
  /**
   * The unit's scope's parked streams of the consumer; a namespace-scope unit: every scope's.
   * Ordered by scope id, `from`, stream type and stream id.
   */
  parked(consumer: string): Promise<readonly ParkedStream[]>;
  /**
   * Starts a `start: 'now'` consumer, in a writing namespace-scope unit only (15.2.3). When the consumer has no start record, this unit records one and gives every scope of the namespace that has events a checkpoint at the head it reads, and leaves every existing checkpoint as it is. Answers true then, and false when the consumer had started already, in which case nothing is written. After the start, a scope without a checkpoint is delivered from its first event.
   */
  startAtHeads(consumer: string): Promise<boolean>;
}
