import { describe, expect, test } from 'vitest';
import { appOf, command, makeModule, noop, shopBase, widget } from '../../test/registry-kit.ts';
import { defineQuery } from '../dsl/define-query.ts';
import { defineSubscription } from '../dsl/define-subscription.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';
import { composeApp } from './compose-app.ts';

const shopWith = (part: object) =>
  appOf([makeModule({ id: 'shop', entities: { widget } }, { actions: { x: part } })]);
const internal = { internal: true } as const;

describe('internalCommands', () => {
  test('a plain internal command composes', () => {
    const app = shopWith(command(internal));
    expect(buildRegistry(app).problems.filter((problem) => problem.severity === 'error')).toEqual(
      [],
    );
    expect(composeApp(app)).toBeDefined();
    expect(buildRegistry(app).actions.get('shop.x')?.internal).toBe(true);
  });

  test.each([
    [
      'a query declared internal',
      () => defineQuery(shopBase as never, { read: noop, ...internal } as never),
    ],
    [
      'a subscription declared internal',
      () =>
        defineSubscription(
          shopBase as never,
          {
            event: shape({}),
            source: noop,
            ...internal,
          } as never,
        ),
    ],
    ['a public command declared internal', () => command({ ...internal, auth: { public: true } })],
    ['an offline command declared internal', () => command({ ...internal, offline: true })],
    ['a command whose internal is a string', () => command({ internal: 'true' })],
    ['a command whose internal is a number', () => command({ internal: 1 })],
    ['a command whose internal is an object', () => command({ internal: {} })],
    ['a command whose internal is false', () => command({ internal: false })],
  ])('%s does not compose', (_name, part) => {
    const found = buildRegistry(shopWith(part())).problems.filter(
      (problem) => problem.code === 'internalCommands' && problem.severity === 'error',
    );
    expect(found.map((problem) => problem.ref)).toEqual(['shop.x']);
  });
});
