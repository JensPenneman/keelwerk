import { describe, expect, test } from 'vitest';
import { renameCondition } from './rename-condition.ts';

const relations: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  shelf: { racks: 'rack' },
  rack: { items: 'item' },
  item: { rack: 'rack' },
};
const targetOf = (entity: string, relation: string): string | undefined =>
  relations[entity]?.[relation];
const renameOf = (entity: string, field: string): string =>
  entity === 'item' && field === 'title' ? 'label' : field;

describe('renameCondition', () => {
  test('follows a one-step relation', () => {
    expect(
      renameCondition({ items: { some: { title: 'x' } } }, 'rack', renameOf, targetOf),
    ).toEqual({ items: { some: { label: 'x' } } });
  });

  test('follows nested relation objects over two hops', () => {
    expect(
      renameCondition(
        { racks: { items: { some: { title: 'x', or: [{ title: 'y' }] } } } },
        'shelf',
        renameOf,
        targetOf,
      ),
    ).toEqual({ racks: { items: { some: { label: 'x', or: [{ label: 'y' }] } } } });
  });

  test('follows a dotted relation key', () => {
    expect(
      renameCondition(
        { 'racks.items': { none: { title: { startsWith: 'a' } } } },
        'shelf',
        renameOf,
        targetOf,
      ),
    ).toEqual({ 'racks.items': { none: { label: { startsWith: 'a' } } } });
  });

  test('renames the fields beside a relation, in and, or and not', () => {
    expect(
      renameCondition(
        { title: 'a', rack: { is: { name: 'r' } }, and: [{ not: { title: 'b' } }] },
        'item',
        renameOf,
        targetOf,
      ),
    ).toEqual({ label: 'a', rack: { is: { name: 'r' } }, and: [{ not: { label: 'b' } }] });
  });

  test('keeps an unchanged condition as it is', () => {
    const same = { racks: { items: { some: { size: 1 } } }, and: [{ name: 'r' }] };
    expect(renameCondition(same, 'shelf', renameOf, targetOf)).toBe(same);
  });

  test('keeps a key __proto__ as an own key beside a renamed field, at any level', () => {
    const sent = JSON.parse(
      '{"title":"a","__proto__":1,"and":[{"title":"b","__proto__":{"x":1}}],"rack":{"is":{"__proto__":"y"}}}',
    );
    const renamed = renameCondition(sent, 'item', renameOf, targetOf) as Record<string, unknown>;
    expect(Object.keys(renamed)).toEqual(['label', '__proto__', 'and', 'rack']);
    expect(Object.getPrototypeOf(renamed)).toBe(Object.prototype);
    expect(Reflect.get(renamed, '__proto__')).toBe(1);
    const [inner] = renamed.and as Record<string, unknown>[];
    expect(Object.keys(inner ?? {})).toEqual(['label', '__proto__']);
    const only = JSON.parse('{"__proto__":"x"}');
    expect(renameCondition(only, 'item', renameOf, targetOf)).toBe(only);
  });

  test('refuses a condition nested over the bounds, with the path of the level', () => {
    let deep: unknown = { title: 'x' };
    for (let level = 0; level < 10_000; level += 1) deep = { not: deep };
    expect(() => renameCondition(deep, 'item', renameOf, targetOf)).toThrow(
      expect.objectContaining({ code: 'core.malformed_request' }),
    );
  });
});
