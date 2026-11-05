import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';

/** The inverse of `encodeEventValue` for one field: the domain value the state row holds. */
export function decodeEventValue(field: FieldDescriptor, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (field.kind) {
    case 'instant':
      return Temporal.Instant.from(String(value));
    case 'date':
      return Temporal.PlainDate.from(String(value));
    case 'integer':
      return field.constraints.wide === true ? BigInt(String(value)) : value;
    case 'binary':
      return typeof value === 'string' ? new Uint8Array(Buffer.from(value, 'base64url')) : value;
    case 'secret':
      // The event carries the text of the sealed value; the state column holds the sealed value itself.
      // A verifier column is text (the adapters' contract), so it keeps the text.
      return typeof value === 'string' ? (parseSealedValueText(value) ?? value) : value;
    case 'set':
      return Array.isArray(value)
        ? new Set(value.map((member) => decodeEventValue(field.inner ?? field, member)))
        : value;
    case 'list':
      return Array.isArray(value)
        ? value.map((member) => decodeEventValue(field.inner ?? field, member))
        : value;
    default:
      return value;
  }
}
