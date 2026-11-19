import type { FieldNode } from '@keelwerk/core';
import { binaryCodec, dateCodec, instantCodec, wideIntegerCodec } from '@keelwerk/core/wire';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function itemsOf(item: FieldNode, wire: readonly unknown[]): unknown[] {
  return wire.map((member) => superjsonValueOf(item, member));
}

/**
 * The superjson values of a wire value over its field node (section 16.7.3): instants, dates, bytes
 * and wide integers revived, sets as `Set`, and shapes, lists and pages walked. A member the node
 * does not name (the `$masked` list) stays as given. Total: a value that is not the wire form of
 * its node passes unchanged, so the encoding of the wire stays the one place that refuses it.
 */
export function superjsonValueOf(node: FieldNode, wire: unknown): unknown {
  switch (node.kind) {
    case 'instant':
      return typeof wire === 'string' ? (instantCodec.fromWire(wire) ?? wire) : wire;
    case 'date':
      return typeof wire === 'string' ? (dateCodec.fromWire(wire) ?? wire) : wire;
    case 'binary':
      return typeof wire === 'string' ? (binaryCodec.fromWire(wire) ?? wire) : wire;
    case 'integer':
      return node.wide && typeof wire === 'string'
        ? (wideIntegerCodec.fromWire(wire) ?? wire)
        : wire;
    case 'list':
      return Array.isArray(wire) ? itemsOf(node.item, wire) : wire;
    case 'set':
      return Array.isArray(wire) ? new Set(itemsOf(node.item, wire)) : wire;
    case 'shape': {
      if (!isRecord(wire)) return wire;
      return Object.fromEntries(
        Object.entries(wire).map(([name, member]) => {
          const field = Object.hasOwn(node.fields, name) ? node.fields[name] : undefined;
          return [name, field === undefined ? member : superjsonValueOf(field, member)];
        }),
      );
    }
    case 'page':
      return isRecord(wire) && Array.isArray(wire.items)
        ? { ...wire, items: itemsOf(node.item, wire.items) }
        : wire;
    default:
      return wire;
  }
}
