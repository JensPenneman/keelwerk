import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { sealedValueText } from '../keys/sealed-value-text.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { Unit } from '../storage/unit.ts';

const encoder = new TextEncoder();

function holdsSecret(field: AnyField): boolean {
  return field.kind === 'secret' || (field.inner !== null && holdsSecret(field.inner));
}

async function sealMember(
  unit: Unit,
  binding: SecretMemberBinding,
  name: string,
  field: AnyField,
  value: unknown,
): Promise<unknown> {
  if (value === undefined || value === null) return value;
  if (field.kind === 'secret') {
    if (typeof value === 'string') {
      if (value === '') return value;
      const sealed = await unit.keys.sealValue(
        { entity: binding.entity, id: binding.id, field: binding.prefix + name },
        encoder.encode(value),
      );
      return sealedValueText(sealed);
    }
    // A reference carried over from a loaded row stays a reference.
    const ref: unknown = typeof value === 'object' ? Reflect.get(value, 'ref') : undefined;
    const { owner } = binding;
    if (owner !== undefined) {
      // Only a reference the effect's own module loaded: another text would open a value sealed elsewhere.
      if (
        typeof value !== 'object' ||
        typeof ref !== 'string' ||
        Reflect.get(value, secretRefOwner) !== owner.module ||
        parseSealedValueText(ref) === undefined
      ) {
        const why = 'takes a plain secret or a reference its module loaded';
        throw errors.validation(`${owner.effect}.${name} ${why}.`, {
          issues: [
            { path: [name], message: `Takes a plain secret or a reference its module loaded.` },
          ],
        });
      }
    }
    if (typeof ref !== 'string') return value;
    return binding.refs === 'text' ? ref : { ref };
  }
  const { inner } = field;
  if (inner === null) return value;
  if (Array.isArray(value)) {
    return Promise.all(value.map((member) => sealMember(unit, binding, name, inner, member)));
  }
  if (value instanceof Set) {
    return Promise.all([...value].map((member) => sealMember(unit, binding, name, inner, member)));
  }
  return value;
}

/** How the secret members of one stored document are sealed (14.7.4, S-127). */
export interface SecretMemberBinding {
  /** The value key's binding is `{ entity, id, field: prefix + member name }`. */
  readonly entity: 'core.effect' | 'core.commandReceipt' | 'core.job';
  readonly id: string;
  readonly prefix: '' | 'output.' | 'outcome.';
  /** A `SecretRef` member (`{ ref }`): stored as its text (`text`, effect records, M1's form) or kept as `{ ref }` (`keep`, receipts, so a replay tells it from a value it sealed). */
  readonly refs: 'text' | 'keep';
  /**
   * Set for an effect: a `{ ref }` is kept only when `module` loaded it (the `secretRefOwner`
   * stamp of `decodeRow`) and its text is a sealed value; any other reference is `validation`.
   * Without it a reference passes as it is (receipts keep it as an object and never open it).
   */
  readonly owner?: { readonly module: string; readonly effect: string };
}

/**
 * Every `field.secret()` member of `schema` in `value`, and each element of a list or set of them:
 * a non-empty string is sealed under a fresh value key (`unit.keys.sealValue`) and replaced by its
 * `kwv1` text; a `{ ref }` follows `binding.refs` and `binding.owner`; other members pass unchanged. Answers `value`
 * itself when the schema has no fields or `value` is no object.
 */
export async function sealSecretMembers(
  unit: Unit,
  binding: SecretMemberBinding,
  schema: StandardSchemaV1,
  value: unknown,
): Promise<unknown> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof value !== 'object' || value === null) return value;
  const secrets = Object.entries(fields).filter(([, field]) => holdsSecret(field));
  if (secrets.length === 0) return value;
  const sealed: Record<string, unknown> = { ...value };
  for (const [name, field] of secrets) {
    if (!Object.hasOwn(sealed, name)) continue;
    sealed[name] = await sealMember(unit, binding, name, field, sealed[name]);
  }
  return sealed;
}
