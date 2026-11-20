import { coreError } from '@keelwerk/core/http';
import { binaryCodec, dateCodec, instantCodec } from '@keelwerk/core/wire';

function isPlain(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The wire string of a value the codec cannot write (an instant outside the years 0000-9999): its own text, which the input decode refuses with an issue. */
function textOr(write: () => string, own: () => string): string {
  try {
    return write();
  } catch {
    return own();
  }
}

/** What oRPC's deserialiser revives beyond the kinds of section 16.4.2, which no other transport can send. */
function foreignKindOf(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isFinite(value)) return 'a number that is not finite';
  if (value instanceof Date) return 'a Date';
  if (value instanceof Map) return 'a Map';
  if (value instanceof URL) return 'a URL';
  if (value instanceof RegExp) return 'a RegExp';
  if (typeof Blob !== 'undefined' && value instanceof Blob) return 'a Blob or File';
  return undefined;
}

function walk(value: unknown, path: readonly PropertyKey[]): unknown {
  if (value instanceof Temporal.Instant) {
    return textOr(
      () => instantCodec.toWire(value),
      () => value.toString(),
    );
  }
  if (value instanceof Temporal.PlainDate) {
    return textOr(
      () => dateCodec.toWire(value),
      () => value.toString(),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return binaryCodec.toWire(value);
  const items = value instanceof Set ? [...value] : Array.isArray(value) ? value : undefined;
  if (items !== undefined) {
    return items.map((item: unknown, index) =>
      item === undefined ? null : walk(item, [...path, index]),
    );
  }
  const foreign = foreignKindOf(value);
  if (foreign !== undefined) {
    throw coreError('core.malformed_request', {
      message: 'The input carries a value that JSON cannot carry.',
      issues: [{ path, message: `Expected a JSON value, got ${foreign}.` }],
    });
  }
  if (isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, member]) => member !== undefined)
        .map(([name, member]) => [name, walk(member, [...path, name])]),
    );
  }
  return value;
}

/**
 * A deep copy of a value oRPC revived, in the wire form of section 16.4.2: instants, dates, wide
 * integers and bytes become their strings, sets become arrays, plain objects and arrays are
 * walked. What only oRPC's own deserialiser can produce is not carried: a Date, a Map, a URL, a
 * RegExp, a Blob or File and a number that is not finite are refused as `core.malformed_request`
 * with an issue at their path, an undefined member is dropped and an undefined array item becomes
 * null, as `JSON.stringify` writes them. The input decode (`decodeActionInput`) then reads one
 * form, whichever serialiser the request came through.
 */
export function wireOfNative(value: unknown): unknown {
  return walk(value, []);
}
