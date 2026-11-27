import { bucketKey } from '../admission/bucket-key.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import { principalRateBucketName } from './principal-rate-bucket-name.ts';

/**
 * The stored names of the request-rate buckets that principals `ids` own in `scope`: the id as a
 * user subject and as a service id, for each id as it is written (every spelling of a subject is in
 * `ids` when the caller passes `subjectSpellings`).
 */
export async function principalRateBuckets(
  keys: KeyService,
  scope: StorageScope,
  ids: readonly string[],
): Promise<readonly string[]> {
  const names: string[] = [];
  for (const id of ids) {
    for (const kind of ['user', 'service']) {
      names.push(await bucketKey(keys, scope, 'core', principalRateBucketName(`${kind}:${id}`)));
    }
  }
  return names;
}
