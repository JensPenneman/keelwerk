import type { ActionEntry } from '../registry/action-entry.ts';
import { isMemberRecord } from './is-member-record.ts';

/**
 * Whether the input of a declared action names `field` as a member the caller has to give: a member
 * the action's own input marks optional or gives a default is one a head caller may leave out (the
 * action's own shape fills in its default), so an older caller leaves it out as well and nothing is
 * filled in for it.
 */
export function inputNamesRequired(action: ActionEntry, field: string): boolean {
  const members: unknown = Reflect.get(action.input, 'fields');
  if (!isMemberRecord(members)) return false;
  const member = members[field];
  if (!isMemberRecord(member)) return false;
  const flags = member.flags;
  return !(isMemberRecord(flags) && (flags.optional === true || flags.defaulted === true));
}
