import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';
import { shownInputDigest } from './shown-input-digest.ts';

/**
 * `record` as explain shows it: the same, with the input digest `shownInputDigest` allows. The
 * `prepare` member is shown as stored: it holds what `prepare` read, was answered and performed, and
 * no digest of anything it returned.
 */
export function shownDecisionRecord(record: EncodedDecisionRecord): EncodedDecisionRecord {
  return { ...record, inputDigest: shownInputDigest(record.inputDigest) };
}
