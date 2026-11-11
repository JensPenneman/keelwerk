import { isSubjectUuid } from '../encryption/is-subject-uuid.ts';
import { processPersonalMembers } from '../registry/process-personal-members.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';

/**
 * The code a reaction's job fails with when the key the reaction declared for an event cannot be
 * used (7.7), or undefined when it can. A key that is not text, or is empty, is
 * `core.reaction_key_invalid`. The instance key of a process that holds personal members is the
 * data subject of those members, so it must be a lower-case UUID: otherwise
 * `core.process_instance_key_invalid`. The dispatcher asks where the key is first known, so a bad
 * key stands in the way of that reaction's job alone.
 */
export function reactionKeyError(reaction: ReactionEntry, declared: unknown): string | undefined {
  if (typeof declared !== 'string' || declared === '') return 'core.reaction_key_invalid';
  if (
    reaction.process === true &&
    processPersonalMembers(reaction).length > 0 &&
    !isSubjectUuid(declared)
  ) {
    return 'core.process_instance_key_invalid';
  }
  return undefined;
}
