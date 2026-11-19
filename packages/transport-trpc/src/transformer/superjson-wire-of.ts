import type { FieldNode } from '@keelwerk/core';
import { binaryCodec, dateCodec, instantCodec, wideIntegerCodec } from '@keelwerk/core/wire';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The wire form of a value its codec cannot write (outside the supported range) stays as given, so the core's decode refuses it. */
function attempt(write: () => unknown, value: unknown): unknown {
  try {
    return write();
  } catch {
    return value;
  }
}

function itemsOf(item: FieldNode, values: Iterable<unknown>): unknown[] {
  return [...values].map((member) => superjsonWireOf(item, member));
}

/**
 * The wire form of a superjson value over its field node, the inverse of `superjsonValueOf`:
 * `Temporal.Instant`, `Temporal.PlainDate`, `Uint8Array`, `bigint` and `Set` go back to the wire
 * through the core's codecs and everything else stays as given. The core decodes the result once
 * (`fromWire`), so a value that is wrong still reaches its validation.
 */
export function superjsonWireOf(node: FieldNode, value: unknown): unknown {
  switch (node.kind) {
    case 'instant':
      return value instanceof Temporal.Instant
        ? attempt(() => instantCodec.toWire(value), value)
        : value;
    case 'date':
      return value instanceof Temporal.PlainDate
        ? attempt(() => dateCodec.toWire(value), value)
        : value;
    case 'binary':
      return value instanceof Uint8Array ? binaryCodec.toWire(value) : value;
    case 'integer':
      return typeof value === 'bigint'
        ? attempt(() => wideIntegerCodec.toWire(value), value)
        : value;
    case 'list':
      return Array.isArray(value) ? itemsOf(node.item, value) : value;
    case 'set':
      return value instanceof Set || Array.isArray(value) ? itemsOf(node.item, value) : value;
    case 'shape': {
      if (!isRecord(value)) return value;
      return Object.fromEntries(
        Object.entries(value).map(([name, member]) => {
          const field = Object.hasOwn(node.fields, name) ? node.fields[name] : undefined;
          return [name, field === undefined ? member : superjsonWireOf(field, member)];
        }),
      );
    }
    case 'page':
      return isRecord(value) && Array.isArray(value.items)
        ? { ...value, items: itemsOf(node.item, value.items) }
        : value;
    default:
      return value;
  }
}
