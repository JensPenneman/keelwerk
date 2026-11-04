import { kebab } from '../naming/kebab.ts';
import { fitPhysicalName } from './fit-physical-name.ts';

/** PostgreSQL's identifier limit in bytes; MySQL's is 64 characters. */
const defaultMaxLength = 63;

/** A field name in snake case: `displayName` becomes `display_name` (section 14.4.2, gap S-59). */
export function physicalColumnName(
  fieldName: string,
  options: { readonly maxLength?: number } = {},
): string {
  return fitPhysicalName(
    kebab(fieldName).replaceAll('-', '_'),
    options.maxLength ?? defaultMaxLength,
  );
}
