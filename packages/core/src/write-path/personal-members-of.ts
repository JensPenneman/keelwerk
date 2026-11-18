import { actionInputFields } from './action-input-fields.ts';
import type { FingerprintSource } from './command-fingerprint.ts';
import type { PersonalMember } from './personal-member.ts';
import { personalMembersOfRecord } from './personal-members-of-record.ts';

/** The members of the input that hold a value and that the action's input declares personal. */
export function personalMembersOf(source: FingerprintSource): readonly PersonalMember[] {
  const { action, input } = source;
  const fields = actionInputFields(action);
  if (fields === undefined || typeof input !== 'object' || input === null) return [];
  return personalMembersOfRecord(fields, input as Readonly<Record<string, unknown>>);
}
