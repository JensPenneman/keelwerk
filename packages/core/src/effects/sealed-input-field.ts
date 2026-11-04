import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/** The name of the first field of `field` (or one it holds) that is personal or a secret, with its path. */
function sealedIn(name: string, field: AnyField): string | undefined {
  if (field.flags.personal !== false || field.kind === 'secret') return name;
  return field.inner === null ? undefined : sealedIn(name, field.inner);
}

/**
 * The first field of an effect's input shape that is personal or a secret, if any. The record of
 * an effect stores its input, and the sealing of personal fields and the secret references arrive
 * with the key service (WP-48, WP-53): until then such an effect is refused instead of stored in
 * plaintext (section 7.9.6).
 */
export function sealedInputField(schema: StandardSchemaV1): string | undefined {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return undefined;
  for (const [name, field] of Object.entries(fields)) {
    const found = sealedIn(name, field);
    if (found !== undefined) return found;
  }
  return undefined;
}
