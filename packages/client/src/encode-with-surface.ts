import type { FieldNode } from '@keelwerk/core';
import { toWire } from '@keelwerk/core/wire';
import { clientFailure } from './client-failure.ts';
import { isRecord } from './is-record.ts';

function isOperation(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value) || value instanceof Set) return false;
  const own = Object.keys(value);
  return own.length > 0 && own.every((key) => keys.includes(key));
}

function encode(node: FieldNode, value: unknown): unknown {
  if (value === null) return null;
  switch (node.kind) {
    case 'shape': {
      if (!isRecord(value)) return toWire(node, value);
      const out: Record<string, unknown> = {};
      for (const [name, member] of Object.entries(node.fields)) {
        const encoded = encode(member, Object.hasOwn(value, name) ? value[name] : undefined);
        if (encoded !== undefined) out[name] = encoded;
      }
      return out;
    }
    case 'set': {
      if (isOperation(value, ['add', 'remove'])) {
        const out: Record<string, unknown> = {};
        for (const key of ['add', 'remove']) {
          const items = value[key];
          if (items === undefined) continue;
          out[key] = toWire(
            { ...node, optional: false },
            Array.isArray(items) ? items : [...(items as Iterable<unknown>)],
          );
        }
        return out;
      }
      return toWire(node, value);
    }
    case 'integer':
    case 'float': {
      if (isOperation(value, ['inc'])) {
        return { inc: toWire({ ...node, optional: false }, value.inc) };
      }
      return toWire(node, value);
    }
    default:
      return toWire(node, value);
  }
}

/**
 * The wire form of an in-process input, by the field node the surface gives it. Only in-process
 * leaves are converted (Temporal, bigint, binary, sets, ids); `null` on a member and the patch
 * operations `{ add, remove }` and `{ inc }` pass through for the server to validate (16.4.2).
 * Any error of the encoding is a `core.validation` failure.
 */
export function encodeWithSurface(node: FieldNode, value: unknown, action: string): unknown {
  try {
    return encode(node, value);
  } catch (failure) {
    if (failure instanceof Error) {
      throw clientFailure(
        'core.validation',
        `The input of ${action} is invalid: ${failure.message}.`,
        { cause: failure },
      );
    }
    throw failure;
  }
}
