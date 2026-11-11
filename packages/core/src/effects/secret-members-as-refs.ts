import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';

function asRef(text: string, owner: string): { readonly ref: string } {
  const ref = { ref: text };
  Object.defineProperty(ref, secretRefOwner, { value: owner });
  return ref;
}

function memberAsRefs(field: AnyField, owner: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (field.kind === 'secret') return typeof value === 'string' ? asRef(value, owner) : value;
  const { inner } = field;
  if (inner === null) return value;
  if (Array.isArray(value)) return value.map((member) => memberAsRefs(inner, owner, member));
  return value;
}

/**
 * A stored document as module code reads it (S-127): every string in a secret member (and in list
 * elements; the stored event form holds sets as arrays) becomes `{ ref: text }` stamped with `secretRefOwner = owner` (non-enumerable, as
 * `decodeRow` does), so only the owning module's reveal opens it. Pure; no key is touched.
 */
export function secretMembersAsRefs(
  schema: StandardSchemaV1,
  owner: string,
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return value;
  const decoded: Record<string, unknown> = { ...value };
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(decoded, name)) continue;
    decoded[name] = memberAsRefs(field, owner, decoded[name]);
  }
  return decoded;
}
