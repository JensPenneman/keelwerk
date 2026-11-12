import type { AnyField } from '../fields/field-def.ts';
import { buildFieldDescriptor } from '../registry/build-field-descriptor.ts';
import { decodeEventValue } from './decode-event-value.ts';

/** A value kept in event form (encodeEventValue) read back through the fields of a shape schema with decodeEventValue: an instant, a date, a wide integer, bytes and a set (also inside a list or a set) come back as themselves; a member that is no field, and a schema that is not a shape of fields, are left as stored. declaredBy resolves own references. Throws on text a field cannot read. */
export function decodeShapeValue(schema: unknown, declaredBy: string, stored: unknown): unknown {
  if (
    typeof schema !== 'object' ||
    schema === null ||
    !('fields' in schema) ||
    typeof stored !== 'object' ||
    stored === null ||
    Array.isArray(stored)
  ) {
    return stored;
  }
  const fields = schema.fields as Readonly<Record<string, AnyField>>;
  const decoded: Record<string, unknown> = { ...stored };
  for (const [name, def] of Object.entries(fields)) {
    if (!Object.hasOwn(decoded, name)) continue;
    const descriptor = buildFieldDescriptor(name, def, {
      declaredBy,
      dataSubject: null,
      tag: 0,
      foreignKeyTo: () => false,
    });
    decoded[name] = decodeEventValue(descriptor, decoded[name]);
  }
  return decoded;
}
