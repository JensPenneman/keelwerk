import { enqueueKey } from '../effects/enqueue-key.ts';
import { jobKeyDigest } from '../effects/job-key-digest.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';

/**
 * The key a reaction's job is stored under: `<reaction id>:<jobKeyDigest of the part>`, 64
 * lower-case hexadecimal characters after the colon. The declared key of a reaction and the
 * instance key of a process may hold personal data, so they never reach `kw_jobs`, an advisory
 * lock, a job carrier or a log line in the clear, and the digest is keyed by the scope's job key
 * secret, so a holder of the dump alone cannot check a guessed part. The same part in the same
 * scope always gives the same key.
 */
export function reactionKeyValue(
  reaction: Pick<ReactionEntry, 'id'>,
  part: string,
  secret: Uint8Array,
): string {
  return enqueueKey(reaction.id, jobKeyDigest(secret, reaction.id, part));
}
