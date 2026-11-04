import { renderTypeId } from '../ids/render-type-id.ts';
import type { FieldNode } from '../surface/field-node.ts';
import { binaryCodec } from './binary-codec.ts';
import { collectionCodec } from './collection-codec.ts';
import { dateCodec } from './date-codec.ts';
import { decimalCodec } from './decimal-codec.ts';
import { instantCodec } from './instant-codec.ts';
import { wideIntegerCodec } from './wide-integer-codec.ts';

function wrong(node: FieldNode, expected: string): TypeError {
  return new TypeError(`a ${node.kind} field expects ${expected}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeShape(
  fields: Readonly<Record<string, FieldNode>>,
  value: unknown,
  node: FieldNode,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw wrong(node, 'an object');
  }
  const out: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(fields)) {
    const encoded = encode(member, Object.hasOwn(value, name) ? value[name] : undefined);
    if (encoded !== undefined) {
      out[name] = encoded;
    }
  }
  return out;
}

function encodeKind(node: FieldNode, value: unknown): unknown {
  switch (node.kind) {
    case 'string':
    case 'text':
    case 'timeZone':
    case 'enum':
    case 'subject':
      if (typeof value !== 'string') throw wrong(node, 'a string');
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw wrong(node, 'a boolean');
      return value;
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw wrong(node, 'a finite number');
      return value;
    case 'serial':
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        throw wrong(node, 'a safe integer');
      return value;
    case 'integer':
      if (node.wide) {
        if (typeof value !== 'bigint') throw wrong(node, 'a bigint');
        return wideIntegerCodec.toWire(value);
      }
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        throw wrong(node, 'a safe integer');
      return value;
    case 'decimal':
      if (typeof value !== 'string') throw wrong(node, 'a decimal string');
      return decimalCodec.toWire(value);
    case 'instant':
      if (!(value instanceof Temporal.Instant)) throw wrong(node, 'a Temporal.Instant');
      return instantCodec.toWire(value);
    case 'date':
      if (!(value instanceof Temporal.PlainDate)) throw wrong(node, 'a Temporal.PlainDate');
      return dateCodec.toWire(value);
    case 'binary':
      if (!(value instanceof Uint8Array)) throw wrong(node, 'bytes');
      return binaryCodec.toWire(value);
    case 'id':
    case 'ref':
      if (typeof value !== 'string') throw wrong(node, 'a UUID string');
      return renderTypeId(node.prefix, value);
    case 'list':
      if (!Array.isArray(value)) throw wrong(node, 'an array');
      return collectionCodec.listToWire(value, (item) => encode(node.item, item));
    case 'set':
      if (!(value instanceof Set) && !Array.isArray(value)) throw wrong(node, 'a set');
      return collectionCodec.setToWire(value, (item) => encode(node.item, item));
    case 'shape':
      return encodeShape(node.fields, value, node);
    case 'page': {
      if (!isRecord(value) || !Array.isArray(value.items)) throw wrong(node, 'a page object');
      return {
        ...value,
        items: collectionCodec.listToWire(value.items, (item) => encode(node.item, item)),
      };
    }
    case 'void':
      return undefined;
    case 'richText':
    case 'blob':
    case 'secret':
    case 'json':
    case 'foreign':
      return value;
    default: {
      const unknownKind: never = node;
      throw new TypeError(`unknown field kind ${JSON.stringify(unknownKind)}`);
    }
  }
}

function encode(node: FieldNode, value: unknown): unknown {
  if (value === undefined || value === null) {
    if (node.optional || node.default !== undefined || node.kind === 'void') {
      return undefined;
    }
    throw wrong(node, 'a value');
  }
  return encodeKind(node, value);
}

/**
 * The JSON form of an in-process value for a field node (sections 16.2.3 and 16.4.2): instants as
 * RFC 3339 strings, wide integers and decimals as strings, binary as base64url, ids as TypeIDs.
 * An absent optional value is `undefined` (omitted by the caller). Throws a `TypeError` when the
 * value does not fit the node, which marks a handler bug.
 */
export function toWire(node: FieldNode, value: unknown): unknown {
  return encode(node, value);
}
