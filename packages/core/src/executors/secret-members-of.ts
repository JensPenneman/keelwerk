import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

function textsOf(name: string, field: AnyField, value: unknown, into: Map<string, string>): void {
  if (value === undefined || value === null) return;
  if (field.kind === 'secret') {
    const ref: unknown = typeof value === 'object' ? Reflect.get(value, 'ref') : value;
    if (typeof ref === 'string' && !into.has(ref)) into.set(ref, name);
    return;
  }
  const { inner } = field;
  if (inner === null) return;
  const members = Array.isArray(value) ? value : value instanceof Set ? [...value] : [];
  for (const member of members) textsOf(name, inner, member, into);
}

/**
 * The reference texts held by the secret members of `input` under `schema`, each with the name of
 * the member that holds it: each `field.secret()` member and the elements of a list or set of
 * them, as the stored text of its `{ ref }`. What an executor may reveal is exactly this set, and a
 * value sealed for the effect opens only for the member it was sealed under.
 */
export function secretMembersOf(
  schema: StandardSchemaV1,
  input: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  const texts = new Map<string, string>();
  for (const [name, field] of Object.entries(fields ?? {})) {
    if (Object.hasOwn(input, name)) textsOf(name, field, input[name], texts);
  }
  return texts;
}
