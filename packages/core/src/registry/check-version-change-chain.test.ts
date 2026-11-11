import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { place, shelfItem, shelfRack } from '../../test/version-change-kit.ts';
import { defineVersionChange } from '../api-versions/define-version-change.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { buildRegistry } from './build-registry.ts';
import { checkVersionChanges } from './check-version-changes.ts';

const base = { id: 'shelf', version: '2.0.0' } as const;

function problemsWith(
  parts: Readonly<Record<string, object>>,
  api?: ReturnType<typeof defineApiVersions>,
) {
  const changes = Object.fromEntries(
    Object.entries(parts).map(([key, spec]) => [
      key,
      defineVersionChange(base as never, { since: '2.0.0', ...spec } as never),
    ]),
  );
  const module = makeModule(
    { ...base, entities: { item: shelfItem, rack: shelfRack } },
    { actions: { place }, changes },
  );
  const app = appOf([module], { api: api ?? null });
  return checkVersionChanges(app, buildRegistry(app)).map((problem) => ({
    code: problem.code,
    ref: problem.ref,
  }));
}

const refused = (ref: string) => ({ code: 'invalidVersionChange', ref });
const threeVersions = (first: readonly string[], second: readonly string[]) =>
  defineApiVersions({
    '2026-01-01': {},
    '2026-02-01': { changes: first },
    '2026-03-01': { changes: second },
  });

describe('checkVersionChanges walks the chain from the head (section 18.2)', () => {
  test('a rename chained over three versions composes', () => {
    const api = threeVersions(['shelf.first'], ['shelf.second']);
    expect(
      problemsWith(
        {
          first: { surface: [{ entity: shelfItem, field: 'title', renamedFrom: 'name' }] },
          second: { surface: [{ entity: shelfItem, field: 'label', renamedFrom: 'title' }] },
        },
        api,
      ),
    ).toEqual([]);
  });

  test('an added required field that is renamed later, and a renamed field that is removed later, compose', () => {
    expect(
      problemsWith({
        first: { surface: [{ entity: shelfItem, field: 'amount', addedRequired: true }] },
        second: { surface: [{ entity: shelfItem, field: 'size', renamedFrom: 'amount' }] },
      }),
    ).toEqual([]);
    expect(
      problemsWith({
        first: { surface: [{ entity: shelfItem, field: 'tag', renamedFrom: 'name' }] },
        second: { surface: [{ entity: shelfItem, field: 'tag', removed: true }] },
      }),
    ).toEqual([]);
  });

  test('a chain refuses a rename of a field the newer change already took away', () => {
    expect(
      problemsWith({
        first: { surface: [{ entity: shelfItem, field: 'title', renamedFrom: 'name' }] },
        second: { surface: [{ entity: shelfItem, field: 'label', renamedFrom: 'heading' }] },
      }),
    ).toEqual([refused('shelf.first')]);
  });

  test('two changes that map onto one older name are refused', () => {
    expect(
      problemsWith({
        labelRename: { surface: [{ entity: shelfItem, field: 'label', renamedFrom: 'title' }] },
        noteRename: { surface: [{ entity: shelfItem, field: 'note', renamedFrom: 'title' }] },
      }),
    ).toEqual([refused('shelf.labelRename')]);
  });

  test('two action renames from one older reference are refused', () => {
    expect(
      problemsWith({
        getRename: { surface: [{ action: 'shelf.item.get', renamedFrom: 'shelf.old' }] },
        queryRename: { surface: [{ action: 'shelf.item.query', renamedFrom: 'shelf.old' }] },
      }),
    ).toEqual([refused('shelf.getRename')]);
  });

  test.each([
    ['a system member', 'createdAt'],
    ['the row id', 'id'],
    ['an operator', 'or'],
    ['the masked list', '$masked'],
  ])('an older name that is %s is refused', (_name, name) => {
    expect(
      problemsWith({
        broken: { surface: [{ entity: shelfItem, field: 'rackId', renamedFrom: name }] },
      }),
    ).toEqual([refused('shelf.broken')]);
    expect(
      problemsWith({ broken: { surface: [{ entity: shelfItem, field: name, removed: true }] } }),
    ).toEqual([refused('shelf.broken')]);
  });

  test('an older name that is a relation of the entity is refused', () => {
    expect(
      problemsWith({
        broken: { surface: [{ entity: shelfRack, field: 'name', renamedFrom: 'items' }] },
      }),
    ).toEqual([refused('shelf.broken')]);
  });
});

describe('checkVersionChanges: added required fields and error codes', () => {
  const added = { entity: shelfItem, field: 'label', addedRequired: true };

  test('an added required field without a default or a transform is refused, once per creating action', () => {
    expect(problemsWith({ broken: { surface: [added] } })).toEqual([
      refused('shelf.broken'),
      refused('shelf.broken'),
    ]);
  });

  test('a declared default or a transform for each creating action makes it valid', () => {
    expect(
      problemsWith({
        fine: { surface: [{ entity: shelfItem, field: 'size', addedRequired: true }] },
      }),
    ).toEqual([]);
    const identity = (value: unknown) => value;
    expect(
      problemsWith({
        fine: {
          surface: [added],
          input: { 'shelf.item.create': identity, 'shelf.item.set': identity },
        },
      }),
    ).toEqual([]);
    expect(
      problemsWith({
        broken: { surface: [added], input: { 'shelf.item.create': identity } },
      }),
    ).toEqual([refused('shelf.broken')]);
  });

  test.each([
    ['a core code', 'core.forbidden'],
    ['a code a head action declares', 'shelf.full'],
    ['a code outside the module', 'other.no_room'],
  ])('an older error code that is %s is refused', (_name, code) => {
    expect(problemsWith({ broken: { surface: [], errors: { 'shelf.full': code } } })).toEqual([
      refused('shelf.broken'),
    ]);
  });

  test('an own, unused older code is valid, also when two head codes merge into it', () => {
    expect(
      problemsWith({
        fine: {
          surface: [],
          errors: { 'shelf.full': 'shelf.no_room', 'core.forbidden': 'shelf.no_room' },
        },
      }),
    ).toEqual([]);
  });
});
