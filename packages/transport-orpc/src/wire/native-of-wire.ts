import type { FieldNode } from '@keelwerk/core';
import { binaryCodec, dateCodec, instantCodec, wideIntegerCodec } from '@keelwerk/core/wire';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(wire: unknown): string | undefined {
  return typeof wire === 'string' ? wire : undefined;
}

/**
 * The inverse of the output encoding along `node`, for the kinds oRPC carries natively: an
 * instant, a date, a wide integer and bytes become their in-process values and a set becomes a
 * `Set`; the fields of a shape, the items of a list or set and the `items` of a page are walked.
 * Ids, references, decimals, json, foreign values and every member the node does not name (the
 * `$masked` member) stay as they are, and so does a value that does not decode.
 */
export function nativeOfWire(node: FieldNode, wire: unknown): unknown {
  switch (node.kind) {
    case 'instant': {
      const text = textOf(wire);
      return (text === undefined ? undefined : instantCodec.fromWire(text)) ?? wire;
    }
    case 'date': {
      const text = textOf(wire);
      return (text === undefined ? undefined : dateCodec.fromWire(text)) ?? wire;
    }
    case 'integer': {
      const text = textOf(wire);
      return node.wide && text !== undefined ? (wideIntegerCodec.fromWire(text) ?? wire) : wire;
    }
    case 'binary': {
      const text = textOf(wire);
      return (text === undefined ? undefined : binaryCodec.fromWire(text)) ?? wire;
    }
    case 'list':
      return Array.isArray(wire) ? wire.map((item) => nativeOfWire(node.item, item)) : wire;
    case 'set':
      return Array.isArray(wire)
        ? new Set(wire.map((item) => nativeOfWire(node.item, item)))
        : wire;
    case 'shape': {
      if (!isRecord(wire)) return wire;
      return Object.fromEntries(
        Object.entries(wire).map(([name, member]) => {
          const field = Object.hasOwn(node.fields, name) ? node.fields[name] : undefined;
          return [name, field === undefined ? member : nativeOfWire(field, member)];
        }),
      );
    }
    case 'page':
      return isRecord(wire) && Array.isArray(wire.items)
        ? { ...wire, items: wire.items.map((item) => nativeOfWire(node.item, item)) }
        : wire;
    default:
      return wire;
  }
}
