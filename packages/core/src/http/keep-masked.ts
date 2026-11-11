import type { FieldNode } from '../surface/field-node.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keepAll(item: FieldNode, values: unknown, encoded: unknown): unknown {
  return Array.isArray(values) && Array.isArray(encoded)
    ? encoded.map((member, index) => keepMasked(item, values[index], member))
    : encoded;
}

/**
 * Puts the `$masked` member the kernel sets on a masked row (section 16.4.5) back on the encoded
 * output, as REST does: `toWire` walks the node's fields only, so the member would be dropped.
 * Walks the output node and its encoded form together, through pages, lists and shapes.
 */
export function keepMasked(node: FieldNode, value: unknown, encoded: unknown): unknown {
  switch (node.kind) {
    case 'shape': {
      if (!isRecord(value) || !isRecord(encoded)) return encoded;
      const members = Object.fromEntries(
        Object.entries(encoded).map(([name, member]) => {
          const field = Object.hasOwn(node.fields, name) ? node.fields[name] : undefined;
          return [name, field === undefined ? member : keepMasked(field, value[name], member)];
        }),
      );
      return Array.isArray(value.$masked) ? { ...members, $masked: value.$masked } : members;
    }
    case 'page':
      return isRecord(value) && isRecord(encoded)
        ? { ...encoded, items: keepAll(node.item, value.items, encoded.items) }
        : encoded;
    case 'list':
    case 'set':
      return keepAll(node.item, value, encoded);
    default:
      return encoded;
  }
}
