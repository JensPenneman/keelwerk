import type { AnyField } from '../fields/field-def.ts';
import { personalFlagOf } from '../fields/personal-flag-of.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/**
 * The first field of an effect's input or output shape that is personal, if any: the checks of
 * what an effect record may hold (section 7.9.6).
 */
export function personalInputField(schema: StandardSchemaV1): string | undefined {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return undefined;
  for (const [name, field] of Object.entries(fields)) {
    if (personalFlagOf(field) !== false) return name;
  }
  return undefined;
}
