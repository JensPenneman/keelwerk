import type { FieldDescriptor } from '../storage/field-descriptor.ts';

/**
 * Replaces the value of every `.hidden()`, `.personal()` and `.secret()` field with a marker, so
 * explain output never shows what the fields keep out of reads (section 16.11.3). Names that are
 * no field of the entity stay.
 */
export function redactKeys(
  fields: Readonly<Record<string, FieldDescriptor>>,
  value: unknown,
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const redacted: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value)) {
    const field = fields[name];
    const kept =
      field === undefined || (field.hidden === false && !field.personal && !field.sealed);
    redacted[name] = kept ? member : '[redacted]';
  }
  return redacted;
}
