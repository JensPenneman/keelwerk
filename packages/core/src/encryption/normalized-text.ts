import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { NormalizerEntry } from './normalizer-registry.ts';

/** The kind's canonical text (14.7.9.3 `exact`): decimal integers, RFC 3339 instants with milliseconds, strings as written. */
function canonicalText(field: FieldDescriptor, value: unknown): string | undefined {
  switch (field.kind) {
    case 'string':
    case 'text':
    case 'enum':
    case 'subject':
    case 'ref':
    case 'timeZone':
    case 'decimal':
      return typeof value === 'string' ? value : undefined;
    case 'integer':
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'number' && Number.isSafeInteger(value)) return value.toString();
      return undefined;
    case 'float':
      return typeof value === 'number' ? String(value) : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? String(value) : undefined;
    case 'instant': {
      const instant =
        value instanceof Temporal.Instant
          ? value
          : typeof value === 'string'
            ? Temporal.Instant.from(value)
            : undefined;
      return instant?.toString({ fractionalSecondDigits: 3 });
    }
    case 'date': {
      const date =
        value instanceof Temporal.PlainDate
          ? value
          : typeof value === 'string'
            ? Temporal.PlainDate.from(value)
            : undefined;
      return date?.toString();
    }
    default:
      return undefined;
  }
}

/**
 * `N(value)` of a personal field: the text its equality tag is computed from. `undefined` when the
 * value is not one the field's kind can be compared by equality with (a set, a list, a document,
 * bytes, or a value of another type).
 */
export function normalizedText(
  field: FieldDescriptor,
  normalizer: NormalizerEntry,
  value: unknown,
): string | undefined {
  const text = canonicalText(field, value);
  return text === undefined ? undefined : normalizer.normalize(text);
}
