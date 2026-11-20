import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';

/** The record with the sealed text of every issued verifier replaced by a marker: explain output never shows one (section 16.11.3). */
export function redactVerifiers(record: EncodedDecisionRecord): EncodedDecisionRecord {
  return {
    ...record,
    answers: record.answers.map((answer) =>
      answer.kind === 'secret' ? { ...answer, verifier: '[redacted]' } : answer,
    ),
  };
}
