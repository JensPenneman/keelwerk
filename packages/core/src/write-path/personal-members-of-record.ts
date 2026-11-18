import type { AnyField } from '../fields/field-def.ts';
import { personalFlagOf } from '../fields/personal-flag-of.ts';
import type { PersonalMember } from './personal-member.ts';

/** The members of `record` that hold a value and that `fields` declare personal. */
export function personalMembersOfRecord(
  fields: Readonly<Record<string, AnyField>>,
  record: Readonly<Record<string, unknown>>,
): readonly PersonalMember[] {
  const present: PersonalMember[] = [];
  for (const [name, field] of Object.entries(fields)) {
    if (record[name] === undefined) continue;
    const flag = personalFlagOf(field);
    if (flag !== false) present.push([name, flag]);
  }
  return present;
}
