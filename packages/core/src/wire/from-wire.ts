import type { StandardIssue, StandardResult } from '../fields/standard-schema-v1.ts';
import { parseTypeId } from '../ids/parse-type-id.ts';
import type { FieldNode } from '../surface/field-node.ts';
import { binaryCodec } from './binary-codec.ts';
import { collectionCodec } from './collection-codec.ts';
import { dateCodec } from './date-codec.ts';
import { decimalCodec } from './decimal-codec.ts';
import { instantCodec } from './instant-codec.ts';
import { toWire } from './to-wire.ts';
import { wideIntegerCodec } from './wide-integer-codec.ts';

type Outcome = StandardResult<unknown>;

function fail(message: string): Outcome {
  return { issues: [{ message }] };
}

function ok(value: unknown): Outcome {
  return { value };
}

function parsed(value: unknown, expected: string): Outcome {
  return value === undefined ? fail(expected) : ok(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withPath(issues: readonly StandardIssue[], key: PropertyKey): StandardIssue[] {
  return issues.map((issue) => ({ ...issue, path: [key, ...(issue.path ?? [])] }));
}

function decodeShape(fields: Readonly<Record<string, FieldNode>>, wire: unknown): Outcome {
  if (!isRecord(wire)) {
    return fail('expected an object');
  }
  const issues: StandardIssue[] = [];
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(wire)) {
    if (!Object.hasOwn(fields, name)) {
      issues.push({ message: 'is not a field of this shape', path: [name] });
    }
  }
  for (const [name, member] of Object.entries(fields)) {
    const result = decode(member, Object.hasOwn(wire, name) ? wire[name] : undefined);
    if (result.issues !== undefined) {
      issues.push(...withPath(result.issues, name));
    } else if (result.value !== undefined) {
      out[name] = result.value;
    }
  }
  return issues.length > 0 ? { issues } : ok(out);
}

function decodePage(node: FieldNode & { readonly kind: 'page' }, wire: unknown): Outcome {
  if (!isRecord(wire) || !Array.isArray(wire.items)) {
    return fail('expected a page object');
  }
  const items = collectionCodec.fromWire(
    'list',
    wire.items,
    (item) => decode(node.item, item),
    (value) => toWire(node.item, value),
  );
  if (items.issues !== undefined) {
    return { issues: withPath(items.issues, 'items') };
  }
  return ok({ ...wire, items: items.value });
}

function decodeKind(node: FieldNode, wire: unknown): Outcome {
  switch (node.kind) {
    case 'string':
    case 'text':
    case 'timeZone':
    case 'enum':
    case 'subject':
      return typeof wire === 'string' ? ok(wire) : fail('expected a string');
    case 'boolean':
      return typeof wire === 'boolean' ? ok(wire) : fail('expected a boolean');
    case 'float':
      return typeof wire === 'number' && Number.isFinite(wire)
        ? ok(wire)
        : fail('expected a finite number');
    case 'serial':
      return typeof wire === 'number' && Number.isSafeInteger(wire)
        ? ok(wire)
        : fail('expected a safe integer');
    case 'integer':
      if (node.wide) {
        return parsed(
          typeof wire === 'string' ? wideIntegerCodec.fromWire(wire) : undefined,
          'expected a decimal integer string within 64 bits',
        );
      }
      return typeof wire === 'number' && Number.isSafeInteger(wire)
        ? ok(wire)
        : fail('expected a safe integer');
    case 'decimal':
      return parsed(
        typeof wire === 'string' ? decimalCodec.fromWire(wire) : undefined,
        'expected a decimal string',
      );
    case 'instant':
      return parsed(
        typeof wire === 'string' ? instantCodec.fromWire(wire) : undefined,
        'expected an RFC 3339 instant',
      );
    case 'date':
      return parsed(
        typeof wire === 'string' ? dateCodec.fromWire(wire) : undefined,
        'expected a YYYY-MM-DD date',
      );
    case 'binary':
      return parsed(
        typeof wire === 'string' ? binaryCodec.fromWire(wire) : undefined,
        'expected a base64url string',
      );
    case 'id':
    case 'ref':
      return parsed(
        typeof wire === 'string' ? parseTypeId(wire, node.prefix) : undefined,
        `expected a TypeID with the prefix '${node.prefix}'`,
      );
    case 'list':
    case 'set':
      return collectionCodec.fromWire(
        node.kind,
        wire,
        (item) => decode(node.item, item),
        (value) => toWire(node.item, value),
      );
    case 'shape':
      return decodeShape(node.fields, wire);
    case 'page':
      return decodePage(node, wire);
    case 'void':
      return wire === undefined ? ok(undefined) : fail('expected no value');
    case 'richText':
    case 'blob':
    case 'secret':
    case 'json':
    case 'foreign':
      return ok(wire);
    default: {
      const unknownKind: never = node;
      return fail(`has an unknown field kind ${JSON.stringify(unknownKind)}`);
    }
  }
}

function decode(node: FieldNode, wire: unknown): Outcome {
  if (wire === undefined) {
    if (node.default !== undefined) {
      return decodeKind(node, node.default);
    }
    return node.optional || node.kind === 'void' ? ok(undefined) : fail('is required');
  }
  return decodeKind(node, wire);
}

/**
 * Decodes the JSON form of a value for a field node into its in-process form (the inverse of
 * `toWire`): instants, dates, wide integers, binary and ids are rebuilt, sets must hold unique
 * items, an id must carry the node's prefix. An absent value takes the node's default, or is
 * `undefined` for an optional node. Constraints (lengths, ranges) are `validateValue`'s job.
 */
export function fromWire(node: FieldNode, wire: unknown): StandardResult<unknown> {
  return decode(node, wire);
}
