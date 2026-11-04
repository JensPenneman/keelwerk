import type { StandardIssue, StandardResult } from '../fields/standard-schema-v1.ts';

function listToWire(items: readonly unknown[], encode: (item: unknown) => unknown): unknown[] {
  return items.map((item) => encode(item));
}

function setToWire(
  items: ReadonlySet<unknown> | readonly unknown[],
  encode: (item: unknown) => unknown,
): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of items) {
    const encoded = encode(item);
    const key = identity(encoded);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(encoded);
    }
  }
  return out;
}

function identity(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => identity(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${identity(Reflect.get(value, key))}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function collectionFromWire(
  kind: 'list' | 'set',
  wire: unknown,
  decode: (item: unknown) => StandardResult<unknown>,
  canonical: (value: unknown) => unknown,
): StandardResult<unknown> {
  if (!Array.isArray(wire)) {
    return { issues: [{ message: 'expected an array' }] };
  }
  const values: unknown[] = [];
  const issues: StandardIssue[] = [];
  const seen = new Set<string>();
  for (const [index, item] of wire.entries()) {
    const result = decode(item);
    if (result.issues !== undefined) {
      issues.push(
        ...result.issues.map((issue) => ({ ...issue, path: [index, ...(issue.path ?? [])] })),
      );
      continue;
    }
    if (kind === 'set') {
      const key = identity(canonical(result.value));
      if (seen.has(key)) {
        issues.push({ message: 'must not repeat an item', path: [index] });
        continue;
      }
      seen.add(key);
    }
    values.push(result.value);
  }
  if (issues.length > 0) {
    return { issues };
  }
  return { value: kind === 'set' ? new Set(values) : values };
}

/** The codec of `list` and `set` fields: arrays on the wire, a set with unique items (section 16.2.3). */
export const collectionCodec: {
  /** An array of the encoded items. */
  listToWire(items: readonly unknown[], encode: (item: unknown) => unknown): unknown[];
  /** An array of the encoded items, in insertion order, each once. */
  setToWire(
    items: ReadonlySet<unknown> | readonly unknown[],
    encode: (item: unknown) => unknown,
  ): unknown[];
  /**
   * Decodes the array of a list or a set through `decode`, collecting the issues of every item
   * with its index in the path. A set refuses duplicate items (`uniqueItems`), compared by the
   * `canonical` wire form of the decoded value.
   */
  fromWire(
    kind: 'list' | 'set',
    wire: unknown,
    decode: (item: unknown) => StandardResult<unknown>,
    canonical: (value: unknown) => unknown,
  ): StandardResult<unknown>;
} = { listToWire, setToWire, fromWire: collectionFromWire };
