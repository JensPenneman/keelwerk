import { describe, expect, test } from 'vitest';
import { nodeOf } from '../../test/field-node-kit.ts';
import { field } from '../fields/field.ts';
import type { AnyField } from '../fields/field-def.ts';
import { shape } from '../fields/shape.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import { renderTypeId } from '../ids/render-type-id.ts';
import { fromWire } from './from-wire.ts';
import { toWire } from './to-wire.ts';

function roundTrip(def: AnyField, value: unknown, wire: unknown): void {
  const node = nodeOf(def);
  const encoded = toWire(node, value);
  expect(encoded).toEqual(wire);
  expect(JSON.parse(JSON.stringify(encoded))).toEqual(wire);
  expect(fromWire(node, JSON.parse(JSON.stringify(encoded)))).toEqual({ value });
}

describe('toWire and fromWire round trips, every kind of the table of 16.2.3', () => {
  const id = newUuidV7();

  test('strings, including characters beyond the Basic Multilingual Plane', () => {
    roundTrip(field.string(), 'plain', 'plain');
    roundTrip(
      field.text(),
      'chess \u{1D5D4}\u{1F600} \u{20BB7}',
      'chess \u{1D5D4}\u{1F600} \u{20BB7}',
    );
    roundTrip(field.string(), 'lone é', 'lone é');
  });

  test('integers, the largest safe integer and wide integers', () => {
    roundTrip(field.integer(), Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    roundTrip(field.integer(), -Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER);
    roundTrip(field.integer({ wide: true }), 2n ** 63n - 1n, '9223372036854775807');
    roundTrip(field.integer({ wide: true }), -(2n ** 63n), '-9223372036854775808');
    roundTrip(
      field.integer({ wide: true }),
      BigInt(Number.MAX_SAFE_INTEGER) + 2n,
      '9007199254740993',
    );
  });

  test('decimals keep their scale', () => {
    roundTrip(field.decimal({ precision: 10, scale: 2 }), '12.50', '12.50');
    roundTrip(field.decimal({ precision: 20, scale: 6 }), '-0.000001', '-0.000001');
    roundTrip(field.decimal({ precision: 5, scale: 0 }), '42', '42');
  });

  test('numbers, booleans, serials, enums, time zones and subjects', () => {
    roundTrip(field.float(), 1.5, 1.5);
    roundTrip(field.boolean(), false, false);
    roundTrip(field.serial(), 7, 7);
    roundTrip(field.enum(['a', 'b']), 'b', 'b');
    roundTrip(field.timeZone(), 'Europe/Brussels', 'Europe/Brussels');
    roundTrip(field.subject(), 'sub-1', 'sub-1');
  });

  test('instants at milliseconds and dates', () => {
    roundTrip(
      field.instant(),
      Temporal.Instant.from('2026-11-05T10:00:00.123Z'),
      '2026-11-05T10:00:00.123Z',
    );
    roundTrip(field.date(), Temporal.PlainDate.from('2026-11-05'), '2026-11-05');
    expect(
      toWire(nodeOf(field.instant()), Temporal.Instant.from('2026-11-05T10:00:00.123987Z')),
    ).toBe('2026-11-05T10:00:00.123Z');
  });

  test('ids and references travel as TypeIDs with the prefix of the node', () => {
    const own = field.ref.own('book');
    roundTrip(own, id, renderTypeId('book', id));
  });

  test('lists, and sets with unique items', () => {
    roundTrip(field.list(field.integer({ wide: true })), [1n, 1n, 3n], ['1', '1', '3']);
    roundTrip(field.set(field.string()), new Set(['x', 'y']), ['x', 'y']);
    const instants = field.set(field.instant());
    roundTrip(instants, new Set([Temporal.Instant.from('2026-01-01T00:00:00Z')]), [
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(
      toWire(nodeOf(instants), [
        Temporal.Instant.from('2026-01-01T00:00:00Z'),
        Temporal.Instant.from('2026-01-01T00:00:00.000Z'),
      ]),
    ).toEqual(['2026-01-01T00:00:00.000Z']);
  });

  test('binary as base64url', () => {
    roundTrip(field.binary(), Uint8Array.of(251, 255, 0), '-_8A');
  });

  test('shapes, with absent optional members omitted', () => {
    const schema = shape({
      when: field.instant(),
      amount: field.integer({ wide: true }).optional(),
      tags: field.set(field.string()),
    });
    const node = nodeOf(field.json(schema));
    const value = {
      when: Temporal.Instant.from('2026-01-01T00:00:00.000Z'),
      tags: new Set(['a']),
    };
    const wire = { when: '2026-01-01T00:00:00.000Z', tags: ['a'] };
    expect(toWire(node, value)).toEqual(wire);
    expect(fromWire(node, wire)).toEqual({ value });
  });

  test('json, rich text, blobs and secrets pass through', () => {
    const richText = { codec: 'loro/1', text: 'hi', delta: [{ insert: 'hi' }], version: 'AA' };
    expect(toWire(nodeOf(field.richText()), richText)).toEqual(richText);
    expect(fromWire(nodeOf(field.secret()), 'plain')).toEqual({ value: 'plain' });
  });
});

describe('toWire refusals', () => {
  test('a value of the wrong type is refused', () => {
    expect(() => toWire(nodeOf(field.instant()), '2026-01-01T00:00:00Z')).toThrow(TypeError);
    expect(() => toWire(nodeOf(field.integer({ wide: true })), 5)).toThrow(TypeError);
    expect(() => toWire(nodeOf(field.integer()), 2 ** 53)).toThrow(TypeError);
  });

  test('a required value cannot be absent and an optional one is omitted', () => {
    expect(toWire(nodeOf(field.string().optional()), undefined)).toBeUndefined();
    expect(() => toWire(nodeOf(field.string()), undefined)).toThrow(TypeError);
  });

  test('instants and dates outside the years 0000-9999 are refused', () => {
    expect(() =>
      toWire(nodeOf(field.instant()), Temporal.Instant.from('+010000-01-01T00:00:00Z')),
    ).toThrow(RangeError);
    expect(() => toWire(nodeOf(field.date()), Temporal.PlainDate.from('-000001-01-01'))).toThrow(
      RangeError,
    );
  });
});
