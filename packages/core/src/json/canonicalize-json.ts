function serializeString(value: string): string {
  if (!value.isWellFormed()) {
    throw new TypeError('A lone surrogate cannot be canonicalised.');
  }
  return JSON.stringify(value);
}

function serialize(value: unknown, path: Set<object>, key = ''): string | undefined {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return serializeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('NaN and Infinity cannot be canonicalised.');
      }
      return JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'bigint':
      throw new TypeError('A bigint cannot be canonicalised.');
    default:
      break;
  }
  const toJson: unknown = Reflect.get(value, 'toJSON');
  if (typeof toJson === 'function') {
    // Date, Temporal values and the like serialise through toJSON, as JSON.stringify does.
    return serialize(Reflect.apply(toJson, value, [key]), path, key);
  }
  if (value instanceof String || value instanceof Number || value instanceof Boolean) {
    return serialize(value.valueOf(), path, key);
  }
  if (path.has(value)) {
    throw new TypeError('A circular structure cannot be canonicalised.');
  }
  path.add(value);
  let result: string;
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      items.push(serialize(value[index], path, String(index)) ?? 'null');
    }
    result = `[${items.join(',')}]`;
  } else {
    const members: string[] = [];
    const record = value as Record<string, unknown>;
    // The default sort compares UTF-16 code units, the order RFC 8785 requires.
    for (const key of Object.keys(record).sort()) {
      const member = serialize(record[key], path, key);
      if (member !== undefined) {
        members.push(`${serializeString(key)}:${member}`);
      }
    }
    result = `{${members.join(',')}}`;
  }
  path.delete(value);
  return result;
}

/**
 * The JSON Canonicalization Scheme of RFC 8785: members sorted by UTF-16 code unit, no white
 * space, numbers and strings as ECMAScript serialises them. Members with no JSON form
 * (`undefined`, functions, symbols) are left out of objects and become `null` in arrays. Objects with `toJSON` (dates, Temporal values) serialise
 * through it and boxed primitives unwrap. A top-level one, NaN, infinities, bigints, lone surrogates and cycles throw a `TypeError`.
 */
export function canonicalizeJson(value: unknown): string {
  const result = serialize(value, new Set());
  if (result === undefined) {
    throw new TypeError('A value with no JSON form cannot be canonicalised.');
  }
  return result;
}
