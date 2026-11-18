import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { FingerprintSource } from './command-fingerprint.ts';
import { type GeneratedRecord, generatedRecordsOf } from './generated-records.ts';
import type { PersonalMember } from './personal-member.ts';

/** The personal flag of a field, or of the personal element a list or set of it holds. */
function personalOf(field: FieldDescriptor): FieldDescriptor['personal'] {
  if (field.personal !== false) return field.personal;
  return field.inner === null ? false : personalOf(field.inner);
}

/**
 * A record of a generated write that holds a personal or a sealed member of the entity, with the
 * personal members.
 */
export interface GeneratedPersonalRecord extends GeneratedRecord {
  readonly members: readonly PersonalMember[];
}

/**
 * The records of a generated `update` or `set` input that hold a member the entity declares
 * personal or seals per value (a secret or a verifier): the members the fingerprint keys and, where
 * their subject resolves from the record (or the `id` of an update), digests like those of a module
 * command. Empty for any other input.
 */
export function generatedPersonalRecords(
  source: FingerprintSource,
): readonly GeneratedPersonalRecord[] {
  const { action } = source;
  if (action.entity === undefined) return [];
  const fields = source.registry.entities.get(action.entity)?.descriptor.fields;
  if (fields === undefined) return [];
  const found: GeneratedPersonalRecord[] = [];
  for (const generated of generatedRecordsOf(action, source.input)) {
    const members: PersonalMember[] = [];
    let sealed = false;
    for (const [name, field] of Object.entries(fields)) {
      if (generated.record[name] === undefined) continue;
      const flag = personalOf(field);
      if (flag !== false) members.push([name, { subject: flag.subject }]);
      if (field.sealed) sealed = true;
    }
    if (members.length > 0 || sealed) found.push({ ...generated, members });
  }
  return found;
}
