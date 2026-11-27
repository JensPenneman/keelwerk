import type { AnyField } from '../fields/field-def.ts';
import type { MarkSite } from '../fields/mark-types.ts';
import { personalFlagAt } from '../fields/personal-flag-at.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

/**
 * The first field of a shape of `site` that is personal where the site does not refuse the mark, if
 * any: the checks of what a record, a receipt or a decision may hold (section 7.9.6).
 */
export function personalInputField(site: MarkSite, schema: StandardSchemaV1): string | undefined {
  const { fields } = schema as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return undefined;
  for (const [name, field] of Object.entries(fields)) {
    if (personalFlagAt(site, field) !== false) return name;
  }
  return undefined;
}
