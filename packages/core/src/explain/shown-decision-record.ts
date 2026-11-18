import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';
import { shownInputDigest } from './shown-input-digest.ts';

/** `record` as explain shows it: the same, with the input digest `shownInputDigest` allows. */
export function shownDecisionRecord(record: EncodedDecisionRecord): EncodedDecisionRecord {
  return { ...record, inputDigest: shownInputDigest(record.inputDigest) };
}
