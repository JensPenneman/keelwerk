import { describe, expect, test } from 'vitest';
import { nodeOf } from '../../test/field-node-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import { renderTypeId } from '../ids/render-type-id.ts';
import { fromWire } from './from-wire.ts';

describe('fromWire misfits', () => {
  test('ids and references need the prefix of the node', () => {
    const id = newUuidV7();
    const own = nodeOf(field.ref.own('book'));
    expect(fromWire(own, renderTypeId('shelf', id)).issues).toBeDefined();
    expect(fromWire(own, id).issues).toBeDefined();
    expect(fromWire(own, 'book_zzzzzzzzzzzzzzzzzzzzzzzzzz').issues).toBeDefined();
  });

  test('a set refuses repeats, judged on the decoded value', () => {
    expect(fromWire(nodeOf(field.set(field.string())), ['x', 'x']).issues).toBeDefined();
    expect(fromWire(nodeOf(field.set(field.integer({ wide: true }))), ['1', '01']).issues).toEqual([
      { message: 'must not repeat an item', path: [1] },
    ]);
    expect(
      fromWire(nodeOf(field.set(field.instant())), [
        '2026-01-01T00:00:00Z',
        '2026-01-01T00:00:00.000Z',
      ]).issues,
    ).toEqual([{ message: 'must not repeat an item', path: [1] }]);
  });

  test('binary refuses padding', () => {
    expect(fromWire(nodeOf(field.binary()), 'AA==').issues).toBeDefined();
  });

  test('a shape names the unknown and the missing members', () => {
    const node = nodeOf(
      field.json(shape({ when: field.instant(), tags: field.set(field.string()) })),
    );
    expect(fromWire(node, { when: '2026-01-01T00:00:00.000Z', tags: [], extra: 1 }).issues).toEqual(
      [{ message: 'is not a field of this shape', path: ['extra'] }],
    );
    expect(fromWire(node, { tags: [] }).issues?.[0]?.path).toEqual(['when']);
  });

  test('void takes no value', () => {
    const node = nodeOf(field.string());
    expect(fromWire({ ...node, kind: 'void' }, undefined)).toEqual({ value: undefined });
    expect(fromWire({ ...node, kind: 'void' }, null).issues).toBeDefined();
  });
});

describe('fromWire absent values and defaults', () => {
  test('an optional value is absent, a required one is refused', () => {
    expect(fromWire(nodeOf(field.string().optional()), undefined)).toEqual({ value: undefined });
    expect(fromWire(nodeOf(field.string()), undefined).issues).toBeDefined();
  });

  test('the default of a node is in wire form and fills an absent value', () => {
    const node = nodeOf(field.instant().default(Temporal.Instant.from('2026-01-01T00:00:00Z')));
    expect(node.default).toBe('2026-01-01T00:00:00.000Z');
    expect(fromWire(node, undefined)).toEqual({
      value: Temporal.Instant.from('2026-01-01T00:00:00Z'),
    });
  });

  test('null is not a value on the wire', () => {
    expect(fromWire(nodeOf(field.string().optional()), null).issues).toBeDefined();
  });
});

describe('fromWire in-process forms', () => {
  test('refuses the in-process forms', () => {
    expect(
      fromWire(nodeOf(field.instant()), Temporal.Instant.from('2026-01-01T00:00:00Z')).issues,
    ).toBeDefined();
    expect(fromWire(nodeOf(field.integer({ wide: true })), 5n).issues).toBeDefined();
    expect(fromWire(nodeOf(field.integer({ wide: true })), 5).issues).toBeDefined();
    expect(fromWire(nodeOf(field.binary()), Uint8Array.of(1)).issues).toBeDefined();
  });
});
