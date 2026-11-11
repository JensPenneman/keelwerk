import { describe, expect, test } from 'vitest';
import { shelfApp } from '../../test/version-change-kit.ts';
import { entityPositions } from './entity-positions.ts';
import { rewritePositions } from './rewrite-positions.ts';

const { registry } = shelfApp();

function action(ref: string) {
  const found = registry.actions.get(ref);
  if (found === undefined) throw new Error(`no action ${ref}`);
  return found;
}

describe('the positions', () => {
  test('every generated action of the table, and a json member', () => {
    const at = (ref: string) => {
      const positions = entityPositions(action(ref));
      return positions === undefined
        ? undefined
        : {
            inputRows: positions.inputRows,
            outputRows: positions.outputRows,
            selections: positions.selections,
            sorts: positions.sorts,
            filters: positions.filters,
          };
    };
    expect(at('shelf.item.create')).toMatchObject({ inputRows: [[]], outputRows: [[]] });
    expect(at('shelf.item.update')).toMatchObject({ inputRows: [['patch']], outputRows: [[]] });
    expect(at('shelf.item.archive')).toMatchObject({ inputRows: [], outputRows: [[]] });
    expect(at('shelf.item.set')).toMatchObject({
      inputRows: [
        ['create', '*'],
        ['update', '*', 'patch'],
      ],
      outputRows: [],
    });
    expect(at('shelf.item.get')).toMatchObject({
      outputRows: [['list', '*']],
      selections: [['properties']],
    });
    expect(at('shelf.item.query')).toMatchObject({
      outputRows: [['items', '*']],
      sorts: [['sort']],
      filters: [['filter']],
    });
    expect(at('shelf.item.queryChanges')).toMatchObject({
      outputRows: [],
      sorts: [['sort']],
      filters: [['filter']],
    });
    expect(at('shelf.item.changes')).toBeUndefined();
    expect(at('shelf.place')).toBeUndefined();
  });

  test('rewritePositions copies only what changes', () => {
    const value = { a: [{ b: 1 }, { b: 2 }], c: { d: 1 } };
    const same = rewritePositions(value, ['c', 'missing'], () => 0);
    expect(same).toBe(value);
    const next = rewritePositions(value, ['a', '*'], (item) => ({
      ...(item as object),
      z: 1,
    })) as typeof value;
    expect(next.c).toBe(value.c);
    expect(next.a).toEqual([
      { b: 1, z: 1 },
      { b: 2, z: 1 },
    ]);
    expect(rewritePositions(value, ['a', '*'], (item) => item)).toBe(value);
  });
});
