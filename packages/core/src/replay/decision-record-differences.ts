import type { DecisionRequest } from '../events/decision-request.ts';
import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { RecordedRequest } from './recorded-request-of.ts';

/**
 * One line for every member of the re-decided decision record that differs from the recorded one:
 * reads, answers, effects and prepare (its reads, answers and inline effect ids; the value it
 * returned is not recorded, so it is not compared) by canonical JSON, the request by the names of its members
 * (a value is sealed, and the re-decide ran with the recorded one): one line for a member the
 * decision reads now and the record did not keep (naming, for a record without a request member,
 * that such a record predates request recording or read none), one for a kept member it no
 * longer reads, and one when the record kept that the connection was read and the re-decide was
 * given none. That one line covers `connection` alone: a re-decide cannot tell whether the build
 * reads an address it was not given, so `connection` is never listed as no longer read then.
 */
export function decisionRecordDifferences(
  redecided: EncodedDecisionRecord,
  recorded: EncodedDecisionRecord,
  recordedRequest: RecordedRequest,
  read: DecisionRequest | undefined,
): readonly string[] {
  const kept: readonly string[] = recordedRequest.kept;
  const differences: string[] = [];
  for (const member of ['reads', 'answers', 'effects'] as const) {
    if (canonicalizeJson(redecided[member]) !== canonicalizeJson(recorded[member])) {
      differences.push(`the decision record's ${member} differ`);
    }
  }
  if (canonicalizeJson(redecided.prepare ?? null) !== canonicalizeJson(recorded.prepare ?? null)) {
    differences.push("the decision record's prepare differs");
  }
  const readNow = Object.keys(read ?? {});
  const unrecorded = recordedRequest.recorded
    ? ''
    : ' (a record without a request member was written before request recording, or by a decision that read none)';
  for (const name of readNow.filter((member) => !kept.includes(member))) {
    differences.push(
      `the decision now reads request member '${name}', which the record did not keep${unrecorded}`,
    );
  }
  const connectionGiven = recordedRequest.request.connection !== undefined;
  for (const name of kept.filter((member) => !readNow.includes(member))) {
    if (name === 'connection' && !connectionGiven) continue;
    differences.push(`the decision no longer reads request member '${name}'`);
  }
  if (kept.includes('connection') && !connectionGiven) {
    differences.push(
      'the decision read the connection (the address), which a record never keeps; the re-decide was given none',
    );
  }
  return differences;
}
