import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import type { Unit } from '../storage/unit.ts';

const decoder = new TextDecoder();

async function openMember(
  unit: Unit,
  opening: SecretMemberOpening,
  name: string,
  field: AnyField,
  value: unknown,
): Promise<unknown> {
  if (field.kind === 'secret') {
    if (typeof value !== 'string') return value;
    const sealed = parseSealedValueText(value);
    if (sealed === undefined) return value;
    const { entity, id, prefix } = opening;
    const plain = await unit.keys.openValue(sealed, { entity, id, field: prefix + name });
    if (plain === undefined) throw errors.conflict(opening.lost);
    return decoder.decode(plain);
  }
  const { inner } = field;
  if (inner === null || !Array.isArray(value)) return value;
  return Promise.all(value.map((member) => openMember(unit, opening, name, inner, member)));
}

/** The binding a document's secret members were sealed under: `prefix + member name` is the field. */
export interface SecretMemberOpening {
  readonly entity: string;
  readonly id: string;
  readonly prefix: string;
  /** The `conflict` message when a key is gone or was sealed for another document. */
  readonly lost: string;
}

/**
 * The counterpart of `sealSecretMembers`: each `kwv1` string in a secret member of `value` is opened
 * with `unit.keys.openValue` against the binding it was sealed under and answered as plaintext;
 * `{ ref }` members and texts that are no `kwv1` pass unchanged. Throws `conflict` with
 * `opening.lost` when a key is gone or was sealed for another document. Answers `value` itself
 * when the schema has no fields or `value` is no object.
 */
export async function openSecretMembers(
  unit: Unit,
  opening: SecretMemberOpening,
  schema: StandardSchemaV1,
  value: unknown,
): Promise<unknown> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const opened: Record<string, unknown> = { ...value };
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(opened, name)) continue;
    opened[name] = await openMember(unit, opening, name, field, opened[name]);
  }
  return opened;
}
