import type { AnyField } from '../fields/field-def.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/** The name of the first field of `field` (or one it holds) that is personal, with its path. */
function personalIn(name: string, field: AnyField): string | undefined {
  if (field.flags.personal !== false) return name;
  return field.inner === null ? undefined : personalIn(name, field.inner);
}

/**
 * The first field of an effect's input or output shape that is personal, if any: the checks of
 * what an effect record may hold (section 7.9.6).
 */
export function personalInputField(schema: StandardSchemaV1): string | undefined {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return undefined;
  for (const [name, field] of Object.entries(fields)) {
    const found = personalIn(name, field);
    if (found !== undefined) return found;
  }
  return undefined;
}
