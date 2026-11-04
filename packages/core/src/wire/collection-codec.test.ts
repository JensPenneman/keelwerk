import { describe, expect, test } from 'vitest';
import { collectionCodec } from './collection-codec.ts';

const asNumber = (
  item: unknown,
): { readonly value: unknown } | { readonly issues: [{ message: string }] } =>
  typeof item === 'number' ? { value: item } : { issues: [{ message: 'expected a number' }] };

const same = (value: unknown): unknown => value;
const decodeSame = (item: unknown): { readonly value: unknown } => ({ value: item });

describe('collectionCodec', () => {
  test('a set drops items that encode alike', () => {
    expect(collectionCodec.setToWire([1, 2, 3], (item) => Number(item) % 2)).toEqual([1, 0]);
  });

  test('a set refuses items whose canonical forms repeat', () => {
    const lower = (value: unknown): unknown => String(value).toLowerCase();
    expect(collectionCodec.fromWire('set', ['a', 'A'], decodeSame, lower).issues).toEqual([
      { message: 'must not repeat an item', path: [1] },
    ]);
  });

  test('writes a set once per item, in insertion order', () => {
    expect(collectionCodec.setToWire(new Set(['b', 'a']), (item) => item)).toEqual(['b', 'a']);
    expect(collectionCodec.setToWire(['a', 'b', 'a'], (item) => item)).toEqual(['a', 'b']);
    expect(collectionCodec.listToWire([1, 1], (item) => item)).toEqual([1, 1]);
  });

  test('reads a list as an array and a set as a Set', () => {
    expect(collectionCodec.fromWire('list', [1, 1, 2], asNumber, same)).toEqual({
      value: [1, 1, 2],
    });
    expect(collectionCodec.fromWire('set', [1, 2], asNumber, same)).toEqual({
      value: new Set([1, 2]),
    });
  });

  test('a set refuses duplicates, including equal objects', () => {
    expect(collectionCodec.fromWire('set', [1, 2, 1], asNumber, same).issues).toEqual([
      { message: 'must not repeat an item', path: [2] },
    ]);
    expect(
      collectionCodec.fromWire(
        'set',
        [
          { a: 1, b: 2 },
          { b: 2, a: 1 },
        ],
        decodeSame,
        same,
      ).issues,
    ).toHaveLength(1);
  });

  test('collects the issues of every item with its index', () => {
    const result = collectionCodec.fromWire('list', [1, 'x', 'y'], asNumber, same);
    expect(result.issues?.map((issue) => issue.path)).toEqual([[1], [2]]);
    expect(collectionCodec.fromWire('list', 'nope', asNumber, same).issues).toBeDefined();
  });
});
