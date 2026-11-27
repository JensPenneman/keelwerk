import { isKweEnvelope } from '../encryption/is-kwe-envelope.ts';
import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { personalFlagAt } from '../fields/personal-flag-at.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { openKwe } from '../keys/open-kwe.ts';
import type { Unit } from '../storage/unit.ts';
import { PersonalKeyDestroyed } from './personal-key-destroyed.ts';

const decoder = new TextDecoder();

/** The binding a job's personal members were sealed under. */
export interface PersonalMemberOpening {
  /** The command id of the job. */
  readonly id: string;
  /** The `conflict` message when a key is gone or the value was sealed for another job. */
  readonly lost: string;
}

/**
 * The counterpart of `sealPersonalMembers`: each `$kwe` envelope in a personal member of `value` is
 * opened with the subject's data key and decoded; other values pass unchanged. Throws
 * `PersonalKeyDestroyed` (`opening.lost`) when the key is gone, because the subject was erased, and
 * `conflict` with `opening.lost` when the envelope was sealed for another job. Answers `value`
 * itself when the schema has no personal member.
 */
export async function openPersonalMembers(
  unit: Unit,
  opening: PersonalMemberOpening,
  schema: StandardSchemaV1,
  value: unknown,
): Promise<unknown> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const opened: Record<string, unknown> = { ...value };
  for (const [name, field] of Object.entries(fields)) {
    if (!(Object.hasOwn(opened, name) && personalFlagAt('commandInput', field) !== false)) continue;
    const stored = opened[name];
    if (!isKweEnvelope(stored)) continue;
    const key = await unit.keys.keyById(stored.k);
    if (key === undefined) throw new PersonalKeyDestroyed(opening.lost);
    const plain = openKwe(stored, key.material, {
      namespace: unit.namespace.id,
      streamId: opening.id,
      eventId: opening.id,
      field: `input.${name}`,
    });
    if (plain === undefined) throw errors.conflict(opening.lost);
    opened[name] = JSON.parse(decoder.decode(plain)) as unknown;
  }
  return opened;
}
