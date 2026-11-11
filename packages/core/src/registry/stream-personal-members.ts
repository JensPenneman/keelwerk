import type { AnyField } from '../fields/field-def.ts';
import type { StreamEntry } from './stream-entry.ts';

/** The personal flag of `field`, or of the personal element a list or set holds. */
function personalOf(field: AnyField): AnyField['flags']['personal'] {
  if (field.flags.personal !== false) return field.flags.personal;
  return field.inner === null ? false : personalOf(field.inner);
}

/** A record member that holds personal data and the path of its data subject on the keyed entity. */
export interface StreamPersonalMember {
  readonly member: string;
  readonly path: string;
}

/**
 * The members of a stream's record that are personal, or hold a personal list or set element, each
 * with its subject path: the field's `subject`, else the keyed entity's `dataSubject`, else `id`.
 * A member that holds a personal element is sealed whole under that element's subject.
 */
export function streamPersonalMembers(
  stream: StreamEntry,
  keyedDataSubject: string | null,
): readonly StreamPersonalMember[] {
  const members: StreamPersonalMember[] = [];
  for (const [member, def] of Object.entries(stream.record.fields)) {
    const flag = personalOf(def);
    if (flag === false) continue;
    members.push({ member, path: flag.subject ?? keyedDataSubject ?? 'id' });
  }
  return members;
}
