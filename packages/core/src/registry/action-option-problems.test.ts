import { describe, expect, test } from 'vitest';
import { appOf, command, makeModule, widget } from '../../test/registry-kit.ts';
import { buildRegistry } from './build-registry.ts';

const unknownAuth = (auth: unknown) =>
  buildRegistry(
    appOf([
      makeModule({ id: 'shop', entities: { widget } }, { actions: { x: command({ auth }) } }),
    ]),
  ).problems.filter((problem) => problem.code === 'unknownAuth' && problem.severity === 'error');

describe('an action whose auth is not a known value does not compose', () => {
  test.each([
    ['{ public: false }', { public: false }],
    ["'public'", 'public'],
    ['true', true],
  ])('%s', (_name, auth) => {
    expect(unknownAuth(auth).map((problem) => problem.ref)).toEqual(['shop.x']);
  });

  test.each([
    ['absent', undefined],
    ["'policy'", 'policy'],
    ['{ public: true }', { public: true }],
  ])('%s composes', (_name, auth) => {
    expect(unknownAuth(auth)).toEqual([]);
  });
});
