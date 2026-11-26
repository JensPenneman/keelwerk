import { describe, expect, test } from 'vitest';
import { appOf, contributionTo, makeModule } from '../../test/registry-kit.ts';
import { core } from '../core-module/module.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { Registry } from '../registry/registry.ts';
import { securityDescriptionsOf } from './security-descriptions-of.ts';
import { surfaceProblemsOf } from './surface-problems-of.ts';

const resolver = (id: string) => ({ id, describe: () => ({ scheme: 'bearer' as const }) });

function registryOf(
  fills: readonly { module: string; bound?: boolean; fill: unknown }[],
): Registry {
  return {
    fills: new Map([
      [
        'core.principalResolvers',
        fills.map((entry) => ({ point: 'core.principalResolvers', bound: false, ...entry })),
      ],
    ]),
  } as unknown as Registry;
}

describe('securityDescriptionsOf: the id of a resolver is its module', () => {
  test("refuses a resolver whose id does not start with its module's id and a dot", () => {
    const { problems, resolvers } = securityDescriptionsOf(
      registryOf([
        { module: 'evil', fill: resolver('auth.session') },
        { module: 'evil', fill: resolver('evilX.keys') },
        { module: 'evil', fill: resolver('evil.keys') },
      ]),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'foreignResolverIds',
        severity: 'error',
        ref: 'auth.session',
      }),
      expect.objectContaining({ code: 'foreignResolverIds', ref: 'evilX.keys' }),
    ]);
    expect(resolvers.map(({ id }) => id)).toEqual(['evil.keys']);
  });

  test('reads the ids a bound fill declares with its static describe', () => {
    const declaring = Object.assign(() => [], {
      describe: () => [{ id: 'auth.session', scheme: 'cookie' as const }],
    });
    const { problems } = securityDescriptionsOf(
      registryOf([{ module: 'evil', bound: true, fill: declaring }]),
    );
    expect(problems).toEqual([
      expect.objectContaining({ code: 'foreignResolverIds', ref: 'auth.session' }),
    ]);
  });

  test('accepts the ids of the filling module', () => {
    const { problems, resolvers } = securityDescriptionsOf(
      registryOf([{ module: 'auth', fill: resolver('auth.session') }]),
    );
    expect(problems).toEqual([]);
    expect(resolvers).toHaveLength(1);
  });

  test('the problems defineApp refuses on include a module that declares the id of another module', () => {
    const evil = makeModule(
      { id: 'evil', contributions: { toCore: contributionTo(core as unknown as AnyModule, {}) } },
      {
        contributes: {
          toCore: { extensionPoints: { principalResolvers: [resolver('auth.session')] } },
        },
      },
    );
    const app = appOf([evil]);
    expect(surfaceProblemsOf(app, buildRegistry(app))).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'foreignResolverIds' })]),
    );
  });
});
