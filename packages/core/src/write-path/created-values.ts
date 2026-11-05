import { errors } from '../errors/errors.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { encodeEventValue } from './encode-event-value.ts';

const systemFields = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'version',
  'kwLastHlc',
  'kwLastHash',
  'kwErasedAt',
]);

/** The `created` event's values: every field after defaults, `stateOnly` fields apart. */
export function createdValues(
  entry: EntityEntry,
  values: Readonly<Record<string, unknown>>,
): { full: Record<string, unknown>; stored: Record<string, unknown> } {
  const full: Record<string, unknown> = {};
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const field = entry.descriptor.fields[name];
    if (field === undefined || systemFields.has(name)) {
      throw errors.validation(`${entry.ref} has no field "${name}"`, {
        issues: [{ path: [name], message: 'Unknown field.' }],
      });
    }
    full[name] = encodeEventValue(value);
    if (!field.stateOnly) stored[name] = full[name];
  }
  return { full, stored };
}
