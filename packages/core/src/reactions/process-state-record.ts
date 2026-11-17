import type { KweEnvelope } from '../keys/kwe-envelope.ts';

/**
 * The cached state of one process instance (S-124), as its stream record holds it (the stored form
 * is final). Exactly one of `text` and `sealed` is present. Both hold the state as JSON text and not
 * as a JSON value: the column that keeps a stream record (`jsonb`) does not keep the order of an
 * object's members, and a state read back with its members in another order could decide another
 * event than the fold the cache stands for.
 */
export interface ProcessStateRecord {
  readonly v: 1;
  /** `processStateFrom`: what the state was folded with. */
  readonly from: string;
  /** The stream version the state is folded to, at least 1. */
  readonly version: number;
  /** The stored hash of the event at `version`: the record binds to the stream's content. */
  readonly hash: string | null;
  /** A process without a data subject: the state's JSON text (`JSON.stringify`). */
  readonly text?: string;
  /** A process with `dataSubject: 'instanceKey'`: the state's JSON text sealed under the subject's data key. */
  readonly sealed?: KweEnvelope;
}
