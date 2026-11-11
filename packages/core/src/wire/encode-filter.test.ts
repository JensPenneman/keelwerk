import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { shopEntityOf, shopItem } from '../../test/shop-surface.ts';
import { decodeFilter } from '../http/decode-filter.ts';
import { renderTypeId } from '../ids/render-type-id.ts';
import { encodeFilter } from './encode-filter.ts';

const uuid = (): fc.Arbitrary<string> => fc.uuid().map((value) => value.toLowerCase());
const operatorOf = fc.constantFrom('eq', 'ne', 'lt', 'lte', 'gt', 'gte');
const flag = fc.boolean();

/** A filter over the shop item in kernel form, with every operator on every id-holding field. */
const filterOf = fc.letrec<{ item: unknown; note: unknown }>((tie) => {
  const idField = (name: string): fc.Arbitrary<Record<string, unknown>> =>
    fc.oneof(
      uuid().map((value) => ({ [name]: value })),
      fc.tuple(operatorOf, uuid()).map(([op, value]) => ({ [name]: { [op]: value } })),
      fc
        .tuple(fc.constantFrom('in', 'nin'), fc.array(uuid(), { maxLength: 4 }))
        .map(([op, values]) => ({ [name]: { [op]: values } })),
      flag.map((value) => ({ [name]: { isNull: value } })),
    );
  const leaf = fc.oneof(
    idField('id'),
    idField('parent'),
    uuid().map((value) => ({ tags: { contains: value } })),
    fc.array(uuid(), { maxLength: 3 }).map((values) => ({ tags: { eq: values } })),
    fc.uniqueArray(uuid(), { maxLength: 3 }).map((values) => ({
      related: { eq: new Set(values) },
    })),
    fc.uniqueArray(uuid(), { maxLength: 3 }).map((values) => ({ related: new Set(values) })),
    uuid().map((value) => ({ related: { contains: value } })),
    fc.string().map((value) => ({ label: { startsWith: value } })),
    fc.string().map((value) => ({ label: value })),
  );
  const note = fc.oneof(idField('id'), idField('item'));
  const quantifier = fc.constantFrom('some', 'none', 'every');
  const compound = (
    child: fc.Arbitrary<unknown>,
    relatedNote: fc.Arbitrary<unknown>,
  ): fc.Arbitrary<Record<string, unknown>> =>
    fc.oneof(
      fc.array(child, { maxLength: 3 }).map((items) => ({ and: items })),
      fc.array(child, { maxLength: 3 }).map((items) => ({ or: items })),
      child.map((inner) => ({ not: inner })),
      fc.tuple(quantifier, relatedNote).map(([q, inner]) => ({ notes: { [q]: inner } })),
      child.map((inner) => ({ owner: { is: inner } })),
      fc.tuple(quantifier, relatedNote).map(([q, inner]) => ({ 'owner.notes': { [q]: inner } })),
      fc.tuple(quantifier, relatedNote).map(([q, inner]) => ({ owner: { notes: { [q]: inner } } })),
    );
  return {
    item: fc.oneof({ depthSize: 'small' }, leaf, compound(tie('item'), tie('note'))),
    note: fc.oneof(
      { depthSize: 'small' },
      note,
      fc.array(note, { maxLength: 2 }).map((items) => ({ and: items })),
    ),
  };
}).item;

const unwrap = (result: { value?: unknown; issues?: unknown }): unknown => {
  expect(result.issues).toBeUndefined();
  return result.value;
};

describe('encodeFilter', () => {
  test('decodeFilter of the encoded filter is the filter, for every operator and every shape', () => {
    fc.assert(
      fc.property(filterOf, (filter) => {
        const wire = unwrap(encodeFilter(filter, shopItem, shopEntityOf));
        expect(decodeFilter(JSON.parse(JSON.stringify(wire)), shopItem, shopEntityOf)).toEqual({
          value: filter,
        });
      }),
      { numRuns: 300 },
    );
  });

  test('renders every id operand as a TypeID of the prefix of its field', () => {
    const [parent, tag, note, other] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const encoded = unwrap(
      encodeFilter(
        {
          parent: { in: [parent], ne: other },
          tags: { contains: tag },
          'owner.notes': { some: { item: note } },
          label: { startsWith: 'itm_' },
          id: other,
        },
        shopItem,
        shopEntityOf,
      ),
    );
    expect(encoded).toEqual({
      parent: { in: [renderTypeId('itm', parent)], ne: renderTypeId('itm', other) },
      tags: { contains: renderTypeId('tag', tag) },
      'owner.notes': { some: { item: renderTypeId('itm', note) } },
      label: { startsWith: 'itm_' },
      id: renderTypeId('itm', other),
    });
  });

  test('a set of references is a Set or an array, and is an array on the wire', () => {
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    const wire = [renderTypeId('tag', a), renderTypeId('tag', b)];
    expect(
      unwrap(encodeFilter({ related: { eq: new Set([a, b]) } }, shopItem, shopEntityOf)),
    ).toEqual({
      related: { eq: wire },
    });
    expect(unwrap(encodeFilter({ related: [a, b] }, shopItem, shopEntityOf))).toEqual({
      related: wire,
    });
    expect(unwrap(encodeFilter({ related: new Set([a, b]) }, shopItem, shopEntityOf))).toEqual({
      related: wire,
    });
    const sent = unwrap(encodeFilter({ related: new Set([a]) }, shopItem, shopEntityOf));
    expect(decodeFilter(JSON.parse(JSON.stringify(sent)), shopItem, shopEntityOf)).toEqual({
      value: { related: new Set([a]) },
    });
  });

  test('leaves null operands, other fields, unknown keys and an unchanged filter as they are', () => {
    const filter = { parent: null, label: 'x', unknown: 'y', and: [{ parent: { isNull: true } }] };
    expect(unwrap(encodeFilter(filter, shopItem, shopEntityOf))).toBe(filter);
  });

  test('refuses an operand that does not fit its field, with the path to it', () => {
    const result = encodeFilter(
      { parent: { in: [crypto.randomUUID(), 7] } },
      shopItem,
      shopEntityOf,
    );
    expect(result.issues?.map((issue) => issue.path)).toEqual([['parent', 'in', 1]]);
    expect(encodeFilter({ parent: { startsWith: 'x' } }, shopItem, shopEntityOf).issues).toEqual([
      { path: ['parent', 'startsWith'], message: 'is not an operator of a field that holds an id' },
    ]);
  });

  test('keeps a key __proto__ as a key', () => {
    const uuidOf = crypto.randomUUID();
    const sent = JSON.parse(`{"parent":"${uuidOf}","__proto__":"x"}`);
    const wire = unwrap(encodeFilter(sent, shopItem, shopEntityOf)) as object;
    expect(Object.keys(wire)).toEqual(['parent', '__proto__']);
    expect(Reflect.get(wire, 'parent')).toBe(renderTypeId('itm', uuidOf));
  });

  test('refuses 10 000 levels with an issue at the level that went over', () => {
    let filter: unknown = { label: 'x' };
    for (let level = 0; level < 10_000; level += 1) filter = { not: filter };
    const result = encodeFilter(filter, shopItem, shopEntityOf);
    expect(result.issues?.map((issue) => issue.path)).toEqual([Array<string>(33).fill('not')]);
  });

  test('counts each segment of a dotted relation path as a level', () => {
    const key = Array<string>(40).fill('owner').join('.');
    const result = encodeFilter({ [key]: { is: { label: 'a' } } }, shopItem, shopEntityOf);
    expect(result.issues?.map((issue) => issue.path)).toEqual([[key]]);
    const lone = encodeFilter({ [key]: { label: 'a' } }, shopItem, shopEntityOf);
    expect(lone.issues?.map((issue) => issue.path)).toEqual([[key]]);
    const scalar = encodeFilter({ [key]: 'a' }, shopItem, shopEntityOf);
    expect(scalar.issues?.map((issue) => issue.path)).toEqual([[key]]);
  });

  test('gives an operand nested too deep its own message', () => {
    let operand: unknown = 'x';
    for (let level = 0; level < 40; level += 1) operand = [operand];
    const result = encodeFilter({ label: { eq: operand } }, shopItem, shopEntityOf);
    expect(result.issues?.map((issue) => issue.message)).toEqual([
      'nests objects and arrays more than 32 levels deep',
    ]);
  });
});
