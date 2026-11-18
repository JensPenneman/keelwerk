import { memberSubjectOf } from '../effects/member-subject-of.ts';
import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { isRowId } from '../generated-actions/is-row-id.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { FingerprintSource } from './command-fingerprint.ts';
import type { FingerprintKeys } from './fingerprint-keys.ts';
import { PersonalKeyDestroyed } from './personal-key-destroyed.ts';
import type { PersonalMember } from './personal-member.ts';
import { personalMemberDigest } from './personal-member-digest.ts';

/** Whether the first step of a subject path names a string that passes `isRowId` in `lookup`. */
function isIdAt(lookup: Readonly<Record<string, unknown>>, path: string): boolean {
  const first = path.split('.')[0] ?? '';
  const value = Object.hasOwn(lookup, first) ? lookup[first] : undefined;
  return typeof value === 'string' && isRowId(value);
}

/**
 * `record` with each personal member that names its subject replaced by `personalMemberDigest`
 * under the data key of that subject (`dataKeys` caches the keys already read): the shred of the
 * subject makes the stored digest uncheckable. A member without a subject, and one whose subject
 * path resolves to nothing in `record`, stay as they are (the outer digest is keyed for them).
 * `forbidden` when the subject has no key on a write that creates keys, else `PersonalKeyDestroyed`
 * (a re-decide, the record of a failed receipt).
 * With `unvalidated` (a record of a generated write, whose client input nothing has validated yet)
 * a subject counts only when it is a string that passes `isRowId`; any other value, a text that is
 * no id or a value of another type, leaves the member under the outer digest, and no data key is
 * asked for it: the client never chooses which subject gets a key, and this never throws.
 */
export async function digestPersonalMembers(
  context: {
    readonly source: FingerprintSource;
    readonly keys: FingerprintKeys;
    readonly dataKeys: Map<string, DataKey>;
  },
  target: {
    readonly record: Readonly<Record<string, unknown>>;
    /** Where a subject path is looked up: the record itself, or the record with the row's id. */
    readonly lookup: Readonly<Record<string, unknown>>;
    readonly fields: Readonly<Record<string, AnyField>>;
    readonly members: readonly PersonalMember[];
    readonly unvalidated?: true;
  },
): Promise<Record<string, unknown>> {
  const { source, keys, dataKeys } = context;
  const { record, lookup, fields, members, unvalidated } = target;
  const { action } = source;
  const digested: Record<string, unknown> = { ...record };
  for (const [name, flag] of members) {
    if (flag.subject === undefined || flag.subject === null) continue;
    if (unvalidated === true && !isIdAt(lookup, flag.subject)) continue;
    const subject = await memberSubjectOf(
      {
        unit: keys.unit,
        registry: source.registry,
        module: action.module,
        input: lookup,
        fields,
        owner: action.ref,
      },
      flag.subject,
    );
    if (subject === undefined || (unvalidated === true && !isRowId(subject))) continue;
    let key = dataKeys.get(subject);
    if (key === undefined) {
      key = await keys.unit.keys.dataKey(subject, { create: keys.create });
      if (key === undefined) {
        if (keys.create) {
          throw errors.forbidden('The data subject was erased: personal values cannot be written.');
        }
        throw new PersonalKeyDestroyed(
          `a personal value of "${action.ref}" belongs to a data subject that was erased`,
        );
      }
      dataKeys.set(subject, key);
    }
    digested[name] = personalMemberDigest(key, action.ref, name, digested[name]);
  }
  return digested;
}
