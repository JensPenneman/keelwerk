import type { AnyField } from '../fields/field-def.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';

const generatedOperations = ['set', 'add', 'remove'] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The personal fields a domain event's shape declares, with their subject paths. */
function shapeSubjects(entry: EntityEntry, name: string): ReadonlyMap<string, string> {
  const schema: unknown = entry.events[name];
  const fields = isRecord(schema) ? schema.fields : undefined;
  const subjects = new Map<string, string>();
  if (!isRecord(fields)) return subjects;
  for (const [field, def] of Object.entries<AnyField>(fields as Record<string, AnyField>)) {
    const flag = def.flags.personal;
    if (flag !== false) subjects.set(field, flag.subject ?? entry.descriptor.dataSubject ?? 'id');
  }
  return subjects;
}

/** Where in an event a personal value sits: in `data` or in `before`, at a path whose last segment is the field. */
export interface EventSlot {
  readonly part: 'data' | 'before';
  readonly path: readonly string[];
  readonly field: string;
  /** The field holding the data subject: a path of the entity (14.7.4). */
  readonly subject: string;
}

/**
 * The personal values an event carries (14.7.4): `values` of a created or imported event, the
 * `set`, `add` and `remove` members of a changed event, the declared personal members of a domain
 * event's data, and the personal fields of the before-image. Values that are `null` or absent are
 * not sealed (an absent value leaks presence only).
 */
export function eventSlots(
  entry: EntityEntry,
  name: string,
  data: unknown,
  before: Readonly<Record<string, unknown>> | null,
): readonly EventSlot[] {
  const slots: EventSlot[] = [];
  const personal = (field: string): string | undefined => {
    const declared = Object.hasOwn(entry.descriptor.fields, field)
      ? entry.descriptor.fields[field]
      : undefined;
    return declared === undefined || declared.personal === false
      ? undefined
      : declared.personal.subject;
  };
  const present = (value: unknown): boolean => value !== null && value !== undefined;
  if (isRecord(data)) {
    if (name === 'created' || name === 'imported') {
      const values = data.values;
      if (isRecord(values)) {
        for (const field of Object.keys(values)) {
          const subject = personal(field);
          if (subject !== undefined && present(values[field])) {
            slots.push({ part: 'data', path: ['values', field], field, subject });
          }
        }
      }
    } else if (name === 'changed') {
      for (const operation of generatedOperations) {
        const members = data[operation];
        if (!isRecord(members)) continue;
        for (const field of Object.keys(members)) {
          const subject = personal(field);
          if (subject !== undefined && present(members[field])) {
            slots.push({ part: 'data', path: [operation, field], field, subject });
          }
        }
      }
    } else if (name !== 'archived' && name !== 'restored') {
      for (const [field, subject] of shapeSubjects(entry, name)) {
        if (present(data[field])) slots.push({ part: 'data', path: [field], field, subject });
      }
    }
  }
  if (before !== null) {
    for (const field of Object.keys(before)) {
      const subject = personal(field);
      if (subject !== undefined && present(before[field])) {
        slots.push({ part: 'before', path: [field], field, subject });
      }
    }
  }
  return slots;
}
