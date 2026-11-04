import { core } from '../src/core-module/module.ts';
import { contracts } from '../src/dsl/contracts.ts';
import { extensionPoint } from '../src/dsl/extension-point.ts';
import { field } from '../src/fields/field.ts';
import type { AnyModule } from '../src/model/any-module.ts';
import type { ComposableApp } from '../src/registry/composable-app.ts';
import { accounts } from './fixtures/modules/accounts/src/module.generated.ts';
import { auth } from './fixtures/modules/auth/src/module.generated.ts';
import { hooks } from './fixtures/modules/hooks/src/module.generated.ts';
import { teams } from './fixtures/modules/teams/src/module.generated.ts';
import {
  addedRule,
  appOf,
  type Case,
  contributionTo,
  contributor,
  makeModule,
  reactionPair,
  shop,
  shopWithRule,
} from './registry-kit.ts';

/** Fault cases for list fills, duplicate reactions and the app's rule overrides. */
export const listAndRuleCases: readonly Case[] = [
  {
    name: 'a single point filled with a list of two',
    code: 'singleExtensionPointFillers',
    ref: 'host.slot',
    app: () => {
      const host = makeModule({
        id: 'host',
        extensionPoints: { slot: extensionPoint.single<number>() },
      });
      const filler = makeModule(
        { id: 'one', requires: [host], contributions: { toHost: contributionTo(host, {}) } },
        { contributes: { toHost: { extensionPoints: { slot: [1, 2] } } } },
      );
      return appOf([host, filler]);
    },
  },
  {
    name: 'a reaction id that another module already took',
    code: 'duplicateReactions',
    ref: 'shop.notify',
    app: () => appOf(reactionPair()),
  },
  {
    name: 'a rule added in the app under a taken id',
    code: 'duplicateRuleId',
    ref: 'shop.widget.rule',
    app: () =>
      appOf([shopWithRule()], { policies: { add: [{ ...addedRule, id: 'shop.widget.rule' }] } }),
  },
  {
    name: 'policies.replace for a module without rules',
    code: 'unknownReplacedModule',
    app: () => appOf([shop], { policies: { replace: { shop: [] } } as never }),
  },
  {
    name: 'a read rule for every action that lists a field that is not maskable',
    code: 'readRuleFields',
    ref: 'shop.widget.rule',
    app: () => appOf([shopWithRule({ actions: ['*'], fields: ['name'] })]),
  },
];

/** Sound apps: the core alone, the fixtures, contributions and contracts. */
export const passing: readonly { readonly name: string; readonly app: () => ComposableApp }[] = [
  { name: 'the core alone', app: () => appOf([]) },
  {
    name: 'the accounts, teams, auth and hooks fixtures',
    app: () => appOf([accounts, teams, auth, hooks]),
  },
  { name: 'auth alone, its contributions and conditional parts dropped', app: () => appOf([auth]) },
  {
    name: 'a module that contributes to the core without listing it',
    app: () =>
      appOf([
        makeModule(
          {
            id: 'tools',
            contributions: { toCore: contributionTo(core as unknown as AnyModule, {}) },
          },
          { contributes: { toCore: { extensionPoints: { transports: [{ id: 'stub' }] } } } },
        ),
      ]),
  },
  {
    name: 'a contract provided by a module',
    app: () =>
      appOf([
        makeModule({ id: 'live', provides: [contracts.live] }),
        makeModule({ id: 'user', requires: [contracts.live] }),
      ]),
  },
  {
    name: 'a contributed field with a default',
    app: () =>
      appOf([
        shop,
        contributor('extra', { widget: { fields: { extra: field.string().default('x') } } }),
      ]),
  },
  {
    name: 'an extension point with a filler',
    app: () => {
      const host = makeModule({
        id: 'host',
        extensionPoints: { slot: extensionPoint.single<number>() },
      });
      return appOf([
        host,
        makeModule(
          { id: 'filler', requires: [host], contributions: { toHost: contributionTo(host, {}) } },
          { contributes: { toHost: { extensionPoints: { slot: [1] } } } },
        ),
      ]);
    },
  },
];
