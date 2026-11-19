import type { AnyField } from '../fields/field-def.ts';

/** The `kwv1` texts a secret member holds: the text itself, or each element of a list or set of them. */
export function sealedTextsOf(field: AnyField, value: unknown): readonly string[] {
  if (field.kind === 'secret') return typeof value === 'string' ? [value] : [];
  const { inner } = field;
  if (inner === null || !Array.isArray(value)) return [];
  return value.flatMap((member) => sealedTextsOf(inner, member));
}
