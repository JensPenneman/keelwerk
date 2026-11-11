import { sha256 } from '../crypto/sha256.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';

/**
 * The key a reaction's job is stored under (final): `<reaction id>:<sha256 of the part>`, 64
 * lower-case hexadecimal characters after the colon. The declared key of a reaction and the
 * instance key of a process may hold personal data, so they never reach `kw_jobs`, an advisory
 * lock, a job carrier or a log line in the clear; the same part always gives the same key.
 */
export function reactionKeyValue(reaction: Pick<ReactionEntry, 'id'>, part: string): string {
  return `${reaction.id}:${sha256(part)}`;
}
