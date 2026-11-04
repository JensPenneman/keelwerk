import type { FieldDescriptor } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { fieldOf } from '../../../test/support/field-of.ts';
import { postgresCodecs } from './postgres-codecs.ts';

function roundTrip(field: FieldDescriptor, value: unknown, stored?: unknown): unknown {
  const codec = postgresCodecs.forField(field);
  const bound = codec.encode(value);
  return codec.decode(stored ?? bound);
}

describe('round trips', () => {
  test('strings and enums pass through', () => {
    expect(roundTrip(fieldOf('string', 'c'), 'héllo')).toBe('héllo');
    expect(roundTrip(fieldOf('enum', 'c'), 'open')).toBe('open');
  });

  test('integers are numbers, wide ones bigints; the column is read as text', () => {
    const plain = postgresCodecs.forField(fieldOf('integer', 'c'));
    expect(plain.readAsText).toBe(true);
    expect(plain.encode(7)).toBe(7);
    expect(plain.decode('7')).toBe(7);
    expect(plain.decode(7n)).toBe(7);
    const wide = fieldOf('integer', 'c', { constraints: { wide: true } });
    expect(roundTrip(wide, 9007199254740993n, '9007199254740993')).toBe(9007199254740993n);
    expect(postgresCodecs.forField(wide).encode(9007199254740993n)).toBe('9007199254740993');
    expect(roundTrip(fieldOf('serial', 'c'), 3, '3')).toBe(3);
  });

  test('an integer outside the safe range is refused on read and a fraction on write', () => {
    const plain = postgresCodecs.forField(fieldOf('integer', 'c'));
    expect(() => plain.decode('9007199254740993')).toThrow(RangeError);
    expect(() => plain.encode(1.5)).toThrow(TypeError);
    expect(() => plain.encode('1')).toThrow(TypeError);
  });

  test('decimals stay exact strings', () => {
    expect(roundTrip(fieldOf('decimal', 'c'), '12345678901234567890.12')).toBe(
      '12345678901234567890.12',
    );
  });

  test('floats and booleans', () => {
    expect(roundTrip(fieldOf('float', 'c'), 0.25)).toBe(0.25);
    expect(postgresCodecs.forField(fieldOf('float', 'c')).decode('1.5')).toBe(1.5);
    expect(roundTrip(fieldOf('boolean', 'c'), false)).toBe(false);
  });

  test('instants keep milliseconds and read from Date or text', () => {
    const codec = postgresCodecs.forField(fieldOf('instant', 'c'));
    const instant = Temporal.Instant.from('2026-03-04T05:06:07.891Z');
    expect(codec.encode(Temporal.Instant.from('2026-03-04T05:06:07.8919Z'))).toBe(
      '2026-03-04T05:06:07.891Z',
    );
    expect(codec.decode(new Date('2026-03-04T05:06:07.891Z'))).toEqual(instant);
    expect(codec.decode('2026-03-04 05:06:07.891+00')).toEqual(instant);
    expect(() => codec.encode('2026-03-04')).toThrow(TypeError);
  });

  test('dates are plain dates read as text', () => {
    const codec = postgresCodecs.forField(fieldOf('date', 'c'));
    expect(codec.readAsText).toBe(true);
    expect(codec.encode(Temporal.PlainDate.from('2026-03-04'))).toBe('2026-03-04');
    expect(codec.decode('2026-03-04')).toEqual(Temporal.PlainDate.from('2026-03-04'));
  });

  test('bytes copy out of a Buffer and read hexadecimal text', () => {
    const codec = postgresCodecs.forField(fieldOf('binary', 'c'));
    const bytes = codec.decode(Buffer.from([1, 2, 3]));
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(Buffer.isBuffer(bytes)).toBe(false);
    expect(codec.decode('\\x0102')).toEqual(new Uint8Array([1, 2]));
    expect(codec.sqlType).toBe('bytea');
  });

  test('json values are text on write and parsed on read', () => {
    const codec = postgresCodecs.forField(fieldOf('json', 'c'));
    expect(codec.encode({ a: [1, null] })).toBe('{"a":[1,null]}');
    expect(codec.decode({ a: [1, null] })).toEqual({ a: [1, null] });
  });

  test('sets and lists go through their element codec', () => {
    const inner = fieldOf('instant', 'c');
    const set = fieldOf('set', 'c', { inner });
    const list = fieldOf('list', 'c', { inner });
    const a = Temporal.Instant.from('2026-01-01T00:00:00Z');
    expect(postgresCodecs.forField(set).encode(new Set([a]))).toBe('["2026-01-01T00:00:00Z"]');
    expect(postgresCodecs.forField(set).decode(['2026-01-01T00:00:00Z'])).toEqual(new Set([a]));
    expect(roundTrip(list, [a], ['2026-01-01T00:00:00Z'])).toEqual([a]);
  });

  test('a sequence list is a CRDT document', () => {
    const field = fieldOf('list', 'c', { merge: 'sequence' });
    expect(postgresCodecs.forField(field).sqlType).toBe('bytea');
  });

  test('a sealed credential value keeps its bytes in base64url', () => {
    const codec = postgresCodecs.forField(fieldOf('secret', 'c', { sealed: true }));
    const sealed = {
      keyId: 'k1',
      nonce: new Uint8Array([1, 2, 3]),
      ciphertext: new Uint8Array([250, 251, 252, 253]),
    };
    const stored = codec.encode(sealed);
    expect(JSON.parse(stored as string)).toEqual({
      keyId: 'k1',
      nonce: 'AQID',
      ciphertext: '-vv8_Q',
    });
    expect(codec.decode(JSON.parse(stored as string))).toEqual(sealed);
    expect(codec.decode(stored)).toEqual(sealed);
    expect(() => codec.encode({ keyId: 'k' })).toThrow(TypeError);
  });

  test('a personal field is a sealed bytea column whatever its kind', () => {
    const personal = fieldOf('string', 'c', {
      personal: {
        subject: 'id',
        queries: ['eq'],
        normalize: { id: 'exact', version: 1 },
        params: {
          eq: { bits: 128 },
          prefix: { min: 3, max: 30 },
          contains: { bits: 64 },
          order: { bytes: 8 },
        },
        keys: 'tenant',
      },
    });
    const codec = postgresCodecs.forField(personal);
    expect(codec.sqlType).toBe('bytea');
    const envelope = new Uint8Array([1, 2, 3, 4]);
    expect(codec.decode(codec.encode(envelope))).toEqual(envelope);
    expect(() => codec.encode('plain')).toThrow(TypeError);
  });

  test('nulls read as null', () => {
    for (const kind of ['integer', 'instant', 'date', 'binary', 'secret', 'decimal'] as const) {
      expect(postgresCodecs.forField(fieldOf(kind, 'c')).decode(null)).toBeNull();
    }
  });
});

describe('derived index columns', () => {
  const index = { field: 'email', column: 'email__eq', query: 'eq', keyVersion: 1 } as const;

  test('equality tags are bytea', () => {
    const codec = postgresCodecs.forDerivedIndex({ ...index, kind: 'binary' });
    const tag = new Uint8Array(16).fill(7);
    expect(codec.sqlType).toBe('bytea');
    expect(codec.decode(codec.encode(tag))).toEqual(tag);
  });

  test('tag sets are bigint arrays', () => {
    const codec = postgresCodecs.forDerivedIndex({ ...index, kind: 'tagSet', query: 'prefix' });
    expect(codec.encode([1n, 2n])).toEqual(['1', '2']);
    expect(codec.decode(['1', '2'])).toEqual([1n, 2n]);
  });

  test('order tokens wait for M5', () => {
    expect(() => postgresCodecs.forDerivedIndex({ ...index, kind: 'ore', query: 'order' })).toThrow(
      expect.objectContaining({ kind: 'unsupported' }),
    );
  });
});
