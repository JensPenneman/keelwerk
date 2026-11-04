import { field } from '../fields/field.ts';
import type { AnyField } from '../fields/field-def.ts';

/** The system fields every row has (section 4.2) as fields, so a row can be walked as a shape. */
export function systemFieldDefs(): Readonly<Record<string, AnyField>> {
  return {
    id: field.string(),
    createdAt: field.instant(),
    updatedAt: field.instant(),
    archivedAt: field.instant().optional(),
    version: field.integer(),
  };
}
