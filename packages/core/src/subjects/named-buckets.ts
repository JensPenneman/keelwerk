import { bucketKey } from '../admission/bucket-key.ts';
import type { Reach } from './ask-reaches.ts';
import type { ReachErasureInput } from './reach-erasure-input.ts';
import { subjectSpellings } from './subject-spellings.ts';

/**
 * The stored names of the buckets the fillers name for the person, each under the filler's module
 * (`bucketsOf`, asked once for each text the subject may be stored as, because a bucket is named
 * by the text the rule saw).
 */
export async function namedBuckets(
  input: ReachErasureInput,
  reaches: readonly Reach[],
  addresses: readonly string[],
): Promise<readonly string[]> {
  const { keys } = input.context;
  const names = new Set<string>();
  for (const { module, reach } of reaches) {
    if (reach.bucketsOf === undefined) continue;
    for (const subject of subjectSpellings(input.record.subjectId)) {
      for (const bucket of reach.bucketsOf({ subject, addresses })) {
        names.add(await bucketKey(keys, input.target.scope, module, bucket));
      }
    }
  }
  return [...names];
}
