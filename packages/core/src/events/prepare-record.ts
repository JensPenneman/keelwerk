import type { RecordedAnswer } from './recorded-answer.ts';
import type { RecordedRead } from './recorded-read.ts';

/** What `prepare` read, was answered and performed (7.9.6, S-126): `DecisionRecord.prepare`. */
export interface PrepareRecord {
  /** Per load, in yield order; each load had a read-only unit of its own. */
  readonly reads: readonly RecordedRead[];
  /** Ids and random values `prepare` was answered. */
  readonly answers: readonly RecordedAnswer[];
  /** The inline effect ids, in perform order (`inlineEffectId`). */
  readonly effects: readonly string[];
}
