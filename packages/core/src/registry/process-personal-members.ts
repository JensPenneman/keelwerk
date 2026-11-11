import { personalFlagOf } from '../fields/personal-flag-of.ts';
import type { ReactionEntry } from './reaction-entry.ts';

/** A member of a process event that holds personal data, and the subject path its field names (null: none). */
export interface ProcessPersonalMember {
  readonly event: string;
  readonly member: string;
  readonly subject: string | null;
}

/**
 * The members of a process's events that are personal, or hold a personal list or set element,
 * with the subject path each field names. A process names no entity row, so only the explicit
 * `dataSubject: 'instanceKey'` of the process can say whose data they are (Q2).
 */
export function processPersonalMembers(
  reaction: Pick<ReactionEntry, 'eventShapes'>,
): readonly ProcessPersonalMember[] {
  const members: ProcessPersonalMember[] = [];
  for (const [event, shape] of Object.entries(reaction.eventShapes ?? {})) {
    for (const [member, def] of Object.entries(shape.fields)) {
      const flag = personalFlagOf(def);
      if (flag !== false) members.push({ event, member, subject: flag.subject });
    }
  }
  return members;
}
