import type { AnyField } from '../fields/field-def.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { redactKeys } from './redact-keys.ts';

/** The members of an event payload that hold field values: a create's `values`, an update's operations. */
const valueMembers = new Set(['values', 'set', 'inc', 'add', 'remove']);

/**
 * An event's data with the values of the hidden fields and of every member that holds a mark
 * redacted: the entity's fields in `values` and the operations of a generated event, the members of
 * the shape a domain event declares in its payload (`name` is the event's short name).
 */
export function redactEventData(entry: EntityEntry, name: string, data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const declared = Object.hasOwn(entry.events, name) ? entry.events[name] : undefined;
  const declaredFields = (
    declared as { readonly fields?: Record<string, AnyField> } | null | undefined
  )?.fields;
  if (declaredFields !== undefined) return redactKeys('domainEvent', declaredFields, data);
  const { fields } = entry.descriptor;
  const redacted: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(data)) {
    redacted[member] = valueMembers.has(member) ? redactKeys('entity', fields, value) : value;
  }
  return redacted;
}
