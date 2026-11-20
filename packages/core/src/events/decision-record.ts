import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { PrepareRecord } from './prepare-record.ts';
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
  /** Requested deferred effect ids; the inline ones `prepare` performed are in `prepare.effects`. */
  readonly effects: readonly string[];
  /** What `prepare` read, was answered and performed; absent for a command without `prepare` (S-126). */
  readonly prepare?: PrepareRecord;
  /**
   * The request information the decision read (transport, user agent, and `connection: true`, the
   * fact that the decision read a connection the request carried, never the address) as canonical
   * JSON, only the members it read: a `$kwe` envelope under the data key of the principal subject
   * for a user in a tenant; a value sealed under the long-lived value key of the principal id
   * (`principalValueKeyId`) for any other principal that has one; otherwise a value sealed under a
   * key of its own; absent when it read none. The address is never recorded (S-126). The form is
   * unreleased.
   */
  readonly request?: SealedValue | KweEnvelope;
}
