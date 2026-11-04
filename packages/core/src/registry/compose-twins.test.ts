import { describe, expect, test } from 'vitest';
import {
  addedRule,
  appOf,
  command,
  contributionTo,
  makeModule,
  noop,
  reactionPair,
  shop,
  shopWithRule,
  widget,
} from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import { field } from '../fields/field.ts';
import { buildRegistry } from './build-registry.ts';
import type { ComposableApp } from './composable-app.ts';

/** A sound twin for the check named by `code`: the same shape of app, without the fault. */
const twins: readonly { readonly code: string; readonly app: () => ComposableApp }[] = [
  {
    code: 'unknownExecutionOverrides',
    app: () =>
      appOf([makeModule({ id: 'shop', entities: { widget } }, { actions: { send: command() } })], {
        execution: { 'shop.send': 'async' },
      }),
  },
  {
    code: 'offlineCommands',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { sync: command({ offline: true }) } },
        ),
      ]),
  },
  {
    code: 'prepareNeedsSyncExecution',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { send: command({ prepare: noop }) } },
        ),
      ]),
  },
  {
    code: 'duplicatePrefixes',
    app: () =>
      appOf([
        shop,
        makeModule({
          id: 'other',
          entities: { gizmo: defineEntity({ prefix: 'gzm', fields: { name: field.string() } }) },
        }),
      ]),
  },
  {
    code: 'reservedFieldNames',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: { widget: defineEntity({ prefix: 'wdg', fields: { title: field.string() } }) },
        }),
      ]),
  },
  {
    code: 'columnCollisions',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: {
            widget: defineEntity({ prefix: 'wdg', fields: { shippedAt: field.instant() } }),
          },
        }),
      ]),
  },
  {
    code: 'readRuleFields',
    app: () => appOf([shopWithRule({ actions: ['read'] })]),
  },
  {
    code: 'unknownConditionFields',
    app: () => appOf([shopWithRule({ actions: ['read'], where: () => ({ name: 'a' }) })]),
  },
  {
    code: 'unknownDisabledRule',
    app: () => appOf([shopWithRule()], { policies: { disable: ['shop.widget.rule'] } }),
  },
  {
    code: 'duplicateRuleId',
    app: () => appOf([shopWithRule()], { policies: { add: [addedRule] } }),
  },
  {
    code: 'unknownReplacedModule',
    app: () => appOf([shopWithRule()], { policies: { replace: { shop: [] } } as never }),
  },
  {
    code: 'duplicateReactions',
    app: () => {
      const [own] = reactionPair();
      return appOf(own === undefined ? [] : [own]);
    },
  },
  {
    code: 'singleExtensionPointFillers',
    app: () => {
      const host = makeModule({
        id: 'host',
        extensionPoints: { slot: extensionPoint.single<number>() },
      });
      return appOf([
        host,
        makeModule(
          { id: 'one', requires: [host], contributions: { toHost: contributionTo(host, {}) } },
          { contributes: { toHost: { extensionPoints: { slot: [1] } } } },
        ),
      ]);
    },
  },
];

describe('the sound twin of each check (section 4.7)', () => {
  describe('a twin without the fault raises no problem of that name', () => {
    test.each(twins)('$code', ({ code, app }) => {
      const problems = buildRegistry(app()).problems.filter((problem) => problem.code === code);
      expect(problems).toEqual([]);
    });
  });

  test('a list fill makes one entry per element, ordered by each element', () => {
    const host = makeModule({
      id: 'host',
      extensionPoints: { slot: extensionPoint.ordered<{ order: number }>() },
    });
    const filler = makeModule(
      { id: 'one', requires: [host], contributions: { toHost: contributionTo(host, {}) } },
      { contributes: { toHost: { extensionPoints: { slot: [{ order: 2 }, { order: 1 }] } } } },
    );
    const fills = buildRegistry(appOf([host, filler])).fills.get('host.slot') ?? [];
    expect(fills.map((fill) => fill.order)).toEqual([1, 2]);
  });

  test('policies.add and policies.replace key rules by their own id', () => {
    const registry = buildRegistry(
      appOf([shopWithRule()], {
        policies: {
          add: [addedRule],
          replace: { shop: [{ ...addedRule, id: 'shop.replacement', module: 'shop' }] },
        } as never,
      }),
    );
    expect(registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
    expect(registry.rules.get('app.extra')?.disabled).toBe(false);
    expect(registry.rules.get('shop.widget.rule')?.disabled).toBe(true);
    expect(registry.rules.get('shop.replacement')?.disabled).toBe(false);
  });
});
