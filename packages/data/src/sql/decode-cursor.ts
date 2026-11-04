import type { FieldDescriptor } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';

function mismatch(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'validation', code: 'core.cursor_mismatch', message });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integerPattern = /^-?\d{1,19}$/;
const decimalPattern = /^-?\d+(?:\.\d+)?$/;
const int64Min = -(2n ** 63n);
const int64Max = 2n ** 63n - 1n;

/** A cursor value read back as the domain value of its field; `undefined` when it is not one. */
function domainValue(field: FieldDescriptor, value: unknown): unknown {
  if (value === null) return null;
  switch (field.kind) {
    case 'instant':
      return typeof value === 'string' ? Temporal.Instant.from(value) : undefined;
    case 'date':
      return typeof value === 'string' ? Temporal.PlainDate.from(value) : undefined;
    case 'integer':
    case 'serial': {
      const text = typeof value === 'number' ? String(value) : value;
      if (typeof text !== 'string' || !integerPattern.test(text)) return undefined;
      const wide = BigInt(text);
      if (wide < int64Min || wide > int64Max) return undefined;
      if (field.constraints.wide === true) return wide;
      return Number.isSafeInteger(Number(wide)) ? Number(wide) : undefined;
    }
    case 'string':
    case 'text':
    case 'enum':
    case 'timeZone':
    case 'subject':
      return typeof value === 'string' ? value : undefined;
    case 'ref':
      return typeof value === 'string' && uuidPattern.test(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'float':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'decimal':
      return typeof value === 'string' && decimalPattern.test(value) ? value : undefined;
    default:
      return value;
  }
}

/** A decoded cursor: the sort values in the domain form, then the row id. */
export interface DecodedCursor {
  readonly values: readonly unknown[];
  readonly id: string;
}

/**
 * Decodes a cursor issued for `fields` (the sort keys without `id`; the cursor carries the row
 * id after them) and checks its signature (section 14.3.5). A cursor that does not parse, has the
 * wrong shape, carries another signature (it was issued for a different sort or filter) or holds
 * a value that is not valid for its field is `validation` with the code `core.cursor_mismatch`.
 */
export function decodeCursor(
  cursor: string,
  fields: readonly FieldDescriptor[],
  signature: string,
): DecodedCursor {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw mismatch('the cursor is not valid');
  }
  if (!Array.isArray(parts) || parts.length !== fields.length + 2) {
    throw mismatch('the cursor does not belong to this sort');
  }
  const issuedFor: unknown = parts.at(-1);
  if (issuedFor !== signature) throw mismatch('the cursor was issued for another sort or filter');
  const id: unknown = parts.at(-2);
  if (typeof id !== 'string' || !uuidPattern.test(id)) {
    throw mismatch('the cursor holds no row id');
  }
  const values = fields.map((field, index) => {
    const raw: unknown = parts[index];
    let value: unknown;
    try {
      value = domainValue(field, raw);
    } catch {
      value = undefined;
    }
    // `undefined` marks a value of the wrong type or shape; a stored `null` is `null`.
    if (value === undefined) throw mismatch('the cursor holds a value of the wrong type');
    return value;
  });
  return { values, id };
}
