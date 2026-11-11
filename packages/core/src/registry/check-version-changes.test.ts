import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { place, shelfApp, shelfItem } from '../../test/version-change-kit.ts';
import { defineVersionChange } from '../api-versions/define-version-change.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { buildRegistry } from './build-registry.ts';
import { checkVersionChanges } from './check-version-changes.ts';

const base = { id: 'shelf', version: '2.0.0' } as const;

function problemsWith(
  parts: Readonly<Record<string, object>>,
  api?: ReturnType<typeof defineApiVersions>,
) {
  const changeParts = Object.fromEntries(
    Object.entries(parts).map(([key, spec]) => [
      key,
      defineVersionChange(base as never, spec as never),
    ]),
  );
  const module = makeModule(
    { ...base, entities: { item: shelfItem } },
    { actions: { place }, changes: changeParts },
  );
  const app = appOf([module], { api: api ?? null });
  return checkVersionChanges(app, buildRegistry(app)).map((problem) => ({
    code: problem.code,
    ref: problem.ref,
  }));
}

describe('checkVersionChanges (D11)', () => {
  test('the shelf fixture is clean', () => {
    const { app, registry } = shelfApp();
    expect(checkVersionChanges(app, registry)).toEqual([]);
  });

  test('unknownVersionChange: an adopted id no module registers', () => {
    const api = defineApiVersions({ '2026-11-04': { changes: ['shelf.nothing'] } });
    expect(problemsWith({}, api)).toEqual([{ code: 'unknownVersionChange', ref: 'shelf.nothing' }]);
  });

  test('versionChangeAdoptedTwice', () => {
    const api = defineApiVersions({
      '2026-11-04': { changes: ['shelf.broken'] },
      '2026-11-11': { changes: ['shelf.broken'] },
    });
    expect(problemsWith({ broken: { since: '2.0.0', surface: [] } }, api)).toEqual([
      { code: 'versionChangeAdoptedTwice', ref: 'shelf.broken' },
    ]);
  });

  test('appVersionChangeUnavailable: an object in changes', () => {
    const api = defineApiVersions({ '2026-11-04': { changes: [{ note: 'app-level' }] } });
    expect(problemsWith({}, api)).toEqual([
      { code: 'appVersionChangeUnavailable', ref: '2026-11-04' },
    ]);
  });

  test.each([
    [
      'a field change without a resolved entity',
      { entity: {}, field: 'label', renamedFrom: 'title' },
    ],
    [
      'a rename to a field the head lacks',
      { entity: shelfItem, field: 'missing', renamedFrom: 'x' },
    ],
    ['an added field the head lacks', { entity: shelfItem, field: 'missing', addedRequired: true }],
    [
      'a renamedFrom that is a head field',
      { entity: shelfItem, field: 'label', renamedFrom: 'size' },
    ],
    ['a removed field that is a head field', { entity: shelfItem, field: 'label', removed: true }],
    [
      'an action rename whose head action is missing',
      { action: 'shelf.nothing', renamedFrom: 'shelf.old' },
    ],
    [
      'an older ref that is a head action',
      { action: 'shelf.item.get', renamedFrom: 'shelf.item.query' },
    ],
    ['an older ref in another module', { action: 'shelf.item.get', renamedFrom: 'other.get' }],
  ])('invalidVersionChange: %s', (_name, surface) => {
    expect(problemsWith({ broken: { since: '2.0.0', surface: [surface] } })).toEqual([
      { code: 'invalidVersionChange', ref: 'shelf.broken' },
    ]);
  });

  test('invalidVersionChange: a transform or fixture keyed by a ref that is no head action', () => {
    expect(
      problemsWith({
        broken: { since: '2.0.0', surface: [], input: { 'shelf.nothing': (v: unknown) => v } },
      }),
    ).toEqual([{ code: 'invalidVersionChange', ref: 'shelf.broken' }]);
    expect(
      problemsWith({
        broken: {
          since: '2.0.0',
          surface: [],
          fixtures: [{ ref: 'shelf.nothing', older: {}, newer: {} }],
        },
      }),
    ).toEqual([{ code: 'invalidVersionChange', ref: 'shelf.broken' }]);
  });

  test('a chained action rename is valid', () => {
    expect(
      problemsWith({
        first: { since: '2.0.0', surface: [{ action: 'shelf.put', renamedFrom: 'shelf.drop' }] },
        second: { since: '2.0.0', surface: [{ action: 'shelf.place', renamedFrom: 'shelf.put' }] },
      }),
    ).toEqual([]);
  });
});
