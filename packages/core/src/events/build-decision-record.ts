import type { SealedValue } from '../storage/sealed-value.ts';
import type { DecisionRecord } from './decision-record.ts';
import type { RecordedAnswer } from './recorded-answer.ts';
import type { RecordedRead } from './recorded-read.ts';

/** What a decision record is built from: what the decide phase captured (section 7.9.6). */
export interface DecisionRecordInput {
  /** The action's reference, or a reaction id. */
  readonly part: string;
  /** The receipt's fingerprint. */
  readonly inputDigest: string;
  /** Only for actions with `trace: { input: 'sealed' }`. */
  readonly input?: SealedValue;
  /** Loads in yield order: the target's first, then the handler's. */
  readonly reads: readonly RecordedRead[];
  readonly answers: readonly RecordedAnswer[];
  /** Requested effect ids, inline ones included, in request order. */
  readonly effects: readonly string[];
}

/**
 * The decision record every event of one decision carries. The lists are copied, so the record
 * hashed into the chain cannot change after the events are built, and the optional members are
 * absent rather than undefined.
 */
export function buildDecisionRecord(input: DecisionRecordInput): DecisionRecord {
  return {
    part: input.part,
    inputDigest: input.inputDigest,
    ...(input.input === undefined ? {} : { input: input.input }),
    reads: input.reads.map((read) => ({
      ...(read.scope === undefined ? {} : { scope: read.scope }),
      at: read.at,
    })),
    answers: input.answers.map((answer) => ({ ...answer })),
    effects: [...input.effects],
  };
}
