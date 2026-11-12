import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/**
 * What one sealing pass over the members of a stored document does: which members it seals and
 * how it seals one. A predicate picks the members, so the secret members of a job, effect or
 * receipt and the personal members of a job or effect go through the same loop.
 */
export interface MemberSealer<Selected> {
  /** What the pass needs to seal `field` (a subject path, say), or `undefined` when it leaves the member alone. */
  readonly select: (name: string, field: AnyField) => Selected | undefined;
  /** The stored form of one member that is present and not null. */
  readonly seal: (
    name: string,
    field: AnyField,
    value: unknown,
    selected: Selected,
  ) => Promise<unknown>;
}

/**
 * Seals every member of `value` that `sealer` selects, in the order of the schema's fields, and
 * answers a copy with those members replaced; the other members pass unchanged. An absent, undefined
 * or null member is not sealed (it needs no key and leaks only its presence). Answers `value`
 * itself when the schema has no fields, `value` is no object or nothing was sealed.
 */
export async function sealMembers<Selected>(
  schema: StandardSchemaV1,
  value: unknown,
  sealer: MemberSealer<Selected>,
): Promise<unknown> {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof value !== 'object' || value === null) return value;
  const values = value as Readonly<Record<string, unknown>>;
  let sealed: Record<string, unknown> | undefined;
  for (const [name, field] of Object.entries(fields)) {
    const original = Object.hasOwn(values, name) ? values[name] : undefined;
    if (original === undefined || original === null) continue;
    const selected = sealer.select(name, field);
    if (selected === undefined) continue;
    sealed ??= { ...values };
    sealed[name] = await sealer.seal(name, field, original, selected);
  }
  return sealed ?? value;
}
