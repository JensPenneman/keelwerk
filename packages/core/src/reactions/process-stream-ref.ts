import { jobKeyDigest } from '../effects/job-key-digest.ts';
import { scopeKeyOf } from '../effects/scope-key-of.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { deriveUuidV8 } from '../ids/derive-uuid-v8.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * The state stream of one process instance (S-124, final): the stream type is the process id and
 * the id is the version 8 UUID derived from the scope, the process id and the digest of the
 * instance key under the scope's job key secret (`jobKeyDigest`, owned by the process), so every
 * instance of every tenant has a stream of its own, the same instance always finds it, and the id
 * cannot be computed from a guessed key without the scope key. The digest is taken here: the
 * instance key may hold a personal value, and a caller cannot hand in a plain key as if it were the
 * digest.
 */
export function processStreamRef(
  scope: Scope,
  processId: string,
  instanceKey: string,
  jobKeySecret: Uint8Array,
): StreamRef {
  return {
    type: processId,
    id: deriveUuidV8(
      scopeKeyOf(scope),
      processId,
      jobKeyDigest(jobKeySecret, processId, instanceKey),
    ),
  };
}
