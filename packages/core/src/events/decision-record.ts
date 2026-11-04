import type { SealedValue } from '../storage/sealed-value.ts';
import type { RecordedAnswer } from './recorded-answer.ts';
import type { RecordedRead } from './recorded-read.ts';

/** The record of one decision (section 7.9.6); every event of the decision carries it, hashed with the event. */
export interface DecisionRecord {
  /** 'auth.login'; a reaction id for reactions. */
  readonly part: string;
  /** The receipt's fingerprint. */
  readonly inputDigest: string;
  /** Only with `trace: { input: 'sealed' }` (decision point 79). */
  readonly input?: SealedValue;
  /** Per load, in yield order. */
  readonly reads: readonly RecordedRead[];
  /** Ids, random values, issued secrets' public parts. */
  readonly answers: readonly RecordedAnswer[];
  /** Requested effect ids, inline ones included. */
  readonly effects: readonly string[];
}
