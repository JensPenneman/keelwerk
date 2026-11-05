import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { sealedValueText } from '../keys/sealed-value-text.ts';
import type { Unit } from '../storage/unit.ts';

const encoder = new TextEncoder();

async function sealIn(
  unit: Unit,
  effectId: string,
  name: string,
  field: AnyField,
  value: unknown,
): Promise<unknown> {
  if (value === undefined || value === null) return value;
  if (field.kind === 'secret') {
    if (typeof value === 'string') {
      const sealed = await unit.keys.sealValue(
        { entity: 'core.effect', id: effectId, field: name },
        encoder.encode(value),
      );
      return sealedValueText(sealed);
    }
    // A reference carried over from a loaded row stays a reference: its text.
    const ref: unknown = typeof value === 'object' ? Reflect.get(value, 'ref') : undefined;
    return typeof ref === 'string' ? ref : value;
  }
  if (field.inner !== null && Array.isArray(value)) {
    return Promise.all(
      value.map((member) => sealIn(unit, effectId, name, field.inner as AnyField, member)),
    );
  }
  if (field.inner !== null && value instanceof Set) {
    return Promise.all(
      [...value].map((member) => sealIn(unit, effectId, name, field.inner as AnyField, member)),
    );
  }
  return value;
}

/**
 * The input of an effect as its record stores it (section 7.9.6): every `field.secret()` value is
 * sealed under its own value key, so the record and the job hold `kwv1.<key id>.<nonce>.<ciphertext>`
 * and never the plain value. Other fields pass unchanged.
 */
export async function sealEffectInput(
  unit: Unit,
  effectId: string,
  schema: StandardSchemaV1,
  input: unknown,
): Promise<unknown> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof input !== 'object' || input === null) return input;
  const sealed: Record<string, unknown> = { ...input };
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(sealed, name)) continue;
    sealed[name] = await sealIn(unit, effectId, name, field, sealed[name]);
  }
  return sealed;
}
