import type { AnyField } from '../fields/field-def.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { buildFieldDescriptor } from '../registry/build-field-descriptor.ts';
import { decodeEventValue } from './decode-event-value.ts';

/**
 * The value a receipt kept (`encodeEventValue` of the output) read back through the action's
 * output schema, so an instant, a wide integer, bytes or a set come back as themselves. An output
 * that is not a shape of fields is JSON already and is returned as stored.
 */
export function decodeCommandValue(action: ActionEntry, stored: unknown): unknown {
  const schema: unknown = action.output;
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
      declaredBy: action.module,
      dataSubject: null,
      tag: 0,
      foreignKeyTo: () => false,
    });
    decoded[name] = decodeEventValue(descriptor, decoded[name]);
  }
  return decoded;
}
