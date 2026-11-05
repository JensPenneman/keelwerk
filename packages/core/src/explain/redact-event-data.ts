import type { EntityEntry } from '../registry/entity-entry.ts';
import { redactKeys } from './redact-keys.ts';

/** The members of an event payload that hold field values: a create's `values`, an update's operations. */
const valueMembers = new Set(['values', 'set', 'inc', 'add', 'remove']);

/** An event's data with the values of the entity's hidden, personal and secret fields redacted. */
export function redactEventData(entry: EntityEntry, data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const { fields } = entry.descriptor;
  const redacted: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(data)) {
    redacted[name] = valueMembers.has(name) ? redactKeys(fields, member) : member;
  }
  return redacted;
}
