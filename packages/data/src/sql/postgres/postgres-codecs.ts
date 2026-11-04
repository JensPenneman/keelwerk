import type { FieldDescriptor } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { identityCodec } from '../identity-codec.ts';
import type { DialectCodecs, ValueCodec } from '../value-codec.ts';

function fail(expected: string, value: unknown): never {
  throw new TypeError(`expected ${expected}, got ${typeof value}`);
}

function text(sqlType: string): ValueCodec {
  return { ...identityCodec, sqlType, readAsText: false };
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (typeof value === 'string' && value.startsWith('\\x')) {
    return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
  }
  return fail('bytes', value);
}

const bytea: ValueCodec = {
  encode: (value) => (value instanceof Uint8Array ? value : fail('Uint8Array', value)),
  decode: (value) => (value === null ? null : asBytes(value)),
  sqlType: 'bytea',
  readAsText: false,
};

function integer(field: FieldDescriptor): ValueCodec {
  const wide = field.constraints.wide === true;
  return {
    encode: (value) => {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
      return fail('an integer', value);
    },
    decode: (value) => {
      if (value === null) return null;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
        return fail('an integer', value);
      }
      const parsed = BigInt(value);
      if (wide) return parsed;
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError(
          `column ${field.column} holds ${parsed}, outside the safe integer range`,
        );
      }
      return Number(parsed);
    },
    sqlType: 'bigint',
    readAsText: true,
  };
}

const instant: ValueCodec = {
  // Millisecond precision, as the column has (section 14.5.3).
  encode: (value) =>
    value instanceof Temporal.Instant
      ? Temporal.Instant.fromEpochMilliseconds(value.epochMilliseconds).toString()
      : fail('a Temporal.Instant', value),
  decode: (value) => {
    if (value === null) return null;
    if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(value.getTime());
    if (typeof value === 'string') return Temporal.Instant.from(value);
    return fail('a timestamp', value);
  },
  sqlType: 'timestamptz',
  readAsText: false,
};

const date: ValueCodec = {
  encode: (value) =>
    value instanceof Temporal.PlainDate ? value.toString() : fail('a Temporal.PlainDate', value),
  decode: (value) => {
    if (value === null) return null;
    if (typeof value === 'string') return Temporal.PlainDate.from(value);
    return fail('a date string', value);
  },
  sqlType: 'date',
  readAsText: true,
};

const decimal: ValueCodec = {
  encode: (value) => (typeof value === 'string' ? value : fail('a decimal string', value)),
  decode: (value) => (value === null ? null : String(value)),
  sqlType: 'numeric',
  readAsText: true,
};

const float: ValueCodec = {
  encode: (value) => (typeof value === 'number' ? value : fail('a number', value)),
  decode: (value) => (value === null ? null : Number(value)),
  sqlType: 'double precision',
  readAsText: false,
};

const json: ValueCodec = {
  encode: (value) => JSON.stringify(value ?? null),
  decode: (value) => value,
  sqlType: 'jsonb',
  readAsText: false,
};

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: unknown): Uint8Array {
  return typeof value === 'string'
    ? Uint8Array.from(Buffer.from(value, 'base64url'))
    : fail('a base64url string', value);
}

/** A sealed credential value: `{ keyId, nonce, ciphertext }` with the bytes in base64url (section 14.5.1). */
const sealed: ValueCodec = {
  encode: (value) => {
    if (typeof value !== 'object' || value === null) return fail('a sealed value', value);
    const { keyId, nonce, ciphertext } = value as {
      keyId: unknown;
      nonce: unknown;
      ciphertext: unknown;
    };
    if (typeof keyId !== 'string') return fail('a key id', keyId);
    if (!(nonce instanceof Uint8Array)) return fail('a nonce', nonce);
    if (!(ciphertext instanceof Uint8Array)) return fail('ciphertext', ciphertext);
    return JSON.stringify({ keyId, nonce: base64Url(nonce), ciphertext: base64Url(ciphertext) });
  },
  decode: (value) => {
    if (value === null) return null;
    const stored = (typeof value === 'string' ? JSON.parse(value) : value) as {
      keyId: unknown;
      nonce: unknown;
      ciphertext: unknown;
    };
    if (typeof stored.keyId !== 'string') return fail('a key id', stored.keyId);
    return {
      keyId: stored.keyId,
      nonce: fromBase64Url(stored.nonce),
      ciphertext: fromBase64Url(stored.ciphertext),
    };
  },
  sqlType: 'jsonb',
  readAsText: false,
};

function elements(
  field: FieldDescriptor,
  codec: (inner: FieldDescriptor) => ValueCodec,
): ValueCodec {
  const inner = field.inner === null ? undefined : codec(field.inner);
  const encodeElement = (value: unknown): unknown =>
    inner === undefined ? value : inner.encode(value);
  const decodeElement = (value: unknown): unknown =>
    inner === undefined ? value : inner.decode(value);
  const isSet = field.kind === 'set';
  return {
    encode: (value) => {
      const list: readonly unknown[] =
        value instanceof Set
          ? [...value]
          : Array.isArray(value)
            ? value
            : fail('a collection', value);
      return JSON.stringify(list.map(encodeElement));
    },
    decode: (value) => {
      if (value === null) return null;
      const list = (typeof value === 'string' ? JSON.parse(value) : value) as unknown;
      if (!Array.isArray(list)) return fail('a JSON array', list);
      const decoded = list.map(decodeElement);
      return isSet ? new Set(decoded) : decoded;
    },
    sqlType: 'jsonb',
    readAsText: false,
  };
}

function forField(field: FieldDescriptor): ValueCodec {
  // A personal field's column is the sealed envelope, whatever the field's kind (section 14.7.9.6).
  if (field.personal !== false) return bytea;
  switch (field.kind) {
    case 'string':
    case 'text':
    case 'enum':
    case 'subject':
    case 'verifier':
    case 'timeZone':
      return text('text');
    case 'ref':
      return text('uuid');
    case 'boolean':
      return { ...identityCodec, sqlType: 'boolean', readAsText: false };
    case 'integer':
    case 'serial':
      return integer(field);
    case 'decimal':
      return decimal;
    case 'float':
      return float;
    case 'instant':
      return instant;
    case 'date':
      return date;
    case 'json':
    case 'blob':
      return json;
    case 'secret':
      return sealed;
    case 'set':
      return elements(field, forField);
    case 'list':
      return field.merge === 'sequence' ? bytea : elements(field, forField);
    case 'richText':
    case 'binary':
      return bytea;
  }
}

/**
 * The PostgreSQL codecs, shared by PGlite and the `pg` adapter (S-10). Statements select 64-bit
 * integers, decimals and dates as text, so decoding does not depend on a driver's type parsers;
 * timestamps arrive as `Date` or text and bytes as `Buffer`, `Uint8Array` or hex text.
 */
export const postgresCodecs: DialectCodecs = {
  forField,
  forDerivedIndex: (index) => {
    switch (index.kind) {
      case 'binary':
        return bytea;
      case 'tagSet':
        return {
          encode: (value) =>
            Array.isArray(value) ? value.map((tag) => String(tag)) : fail('a tag list', value),
          decode: (value) =>
            Array.isArray(value) ? value.map((tag) => BigInt(String(tag))) : value,
          sqlType: 'bigint[]',
          readAsText: false,
        };
      case 'ore':
        throw new KeelwerkError({
          kind: 'unsupported',
          code: 'core.personal_operator',
          message: 'order tokens (ORE) are not available before M5',
        });
    }
  },
};
