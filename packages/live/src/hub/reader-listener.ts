import type { KeelwerkError, LiveView, Position } from '@keelwerk/core';
import type { ReaderBatch } from './reader-batch.ts';

/**
 * Whatever follows the batches of a scope: a subscription of an entity, or (without a view) a source
 * that needs the events only, such as pokes.
 */
export interface ReaderListener {
  /** Absent for a listener that needs events only; rows are then loaded for the others, never for it. */
  readonly view?: LiveView | undefined;
  /**
   * Called inside the first pass that carries the listener, with the head that pass read: the batches
   * the listener is given later start after `at`, and what happened up to `at` is its own to read.
   */
  join(at: Position): void;
  /**
   * Inside the pass, synchronously: the streams of the batch the listener cannot decide from what it
   * holds (a subscriber with a partial set, D6). The reader asks the plan of each group once for the
   * union of these, whatever the number of listeners behind it.
   */
  undecided?(batch: ReaderBatch): readonly string[];
  /** After the unit closed: synchronous, never awaited, never throws. */
  deliver(batch: ReaderBatch): void;
  /** The reader gave up: the stream ends with the error. */
  fail(error: KeelwerkError): void;
  /** The hub is closing: the stream ends without a frame. Synchronous, never throws. */
  end(): void;
}
