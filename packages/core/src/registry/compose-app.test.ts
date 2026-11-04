import { describe, expect, test } from 'vitest';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { listAndRuleCases, passing } from '../../test/registry-cases.ts';
import {
  appOf,
  type Case,
  command,
  contributionTo,
  contributor,
  makeModule,
  noop,
  optionalName,
  query,
  shop,
  shopBase,
  widget,
} from '../../test/registry-kit.ts';
import { contracts } from '../dsl/contracts.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineReaction } from '../dsl/define-reaction.ts';
import { defineSchedule } from '../dsl/define-schedule.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { field } from '../fields/field.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from './build-registry.ts';
import { composeApp } from './compose-app.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** Checks whose fault another check names first, so the refusal carries that other name. */
const firstRefusal: Readonly<Record<string, string>> = {
  danglingReferences: 'refsOutsideRequirements',
};

const appLevel: readonly Case[] = [
  ...listAndRuleCases,
  {
    name: 'a required module that is not selected',
    code: 'missingModules',
    ref: 'shop',
    app: () => appOf([makeModule({ id: 'user', requires: [shop] })]),
  },
  {
    name: 'a required contract that no module provides',
    code: 'missingModules',
    ref: 'live',
    app: () => appOf([makeModule({ id: 'user', requires: [contracts.live] })]),
  },
  {
    name: 'an own field and a contributed field of one name',
    code: 'conflictingFields',
    ref: 'shop.widget.name',
    app: () =>
      appOf([
        shop,
        contributor('extra', { widget: { fields: { name: field.string().optional() } } }),
      ]),
  },
  {
    name: 'two contributors of one field',
    code: 'conflictingFields',
    ref: 'shop.widget.extra',
    app: () => appOf([shop, contributor('one', optionalName), contributor('two', optionalName)]),
  },
  {
    name: 'a contribution to an entity the target lacks',
    code: 'unknownContributionTargets',
    ref: 'shop.gadget',
    app: () => appOf([shop, contributor('extra', { gadget: { fields: {} } })]),
  },
  {
    name: 'a reference to a module that is not selected',
    code: 'danglingReferences',
    ref: 'user.note.about',
    app: () =>
      appOf([
        makeModule({
          id: 'user',
          optional: [shop],
          entities: {
            note: defineEntity({
              prefix: 'note',
              fields: { about: field.ref(shop as never, 'widget' as never).optional() },
            }),
          },
        }),
      ]),
  },
  {
    name: 'a policies.disable entry that names no rule',
    code: 'unknownDisabledRule',
    ref: 'shop.widget.gone',
    app: () => appOf([shop], { policies: { disable: ['shop.widget.gone'] } }),
  },
  {
    name: 'an execution override for an unknown reference',
    code: 'unknownExecutionOverrides',
    ref: 'shop.nope',
    app: () => appOf([shop], { execution: { 'shop.nope': 'async' } }),
  },
  {
    name: 'an execution override for a query',
    code: 'unknownExecutionOverrides',
    ref: 'shop.find',
    app: () =>
      appOf([makeModule({ id: 'shop', entities: { widget } }, { actions: { find: query() } })], {
        execution: { 'shop.find': 'async' },
      }),
  },
  {
    name: 'an offline command that is asynchronous',
    code: 'offlineCommands',
    ref: 'shop.sync',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { sync: command({ offline: true, execution: 'async' }) } },
        ),
      ]),
  },
  {
    name: 'prepare on an asynchronous command',
    code: 'prepareNeedsSyncExecution',
    ref: 'shop.send',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { send: command({ prepare: noop, execution: 'async' }) } },
        ),
      ]),
  },
  {
    name: 'a reaction that is asynchronous',
    code: 'asyncReactionsUnavailable',
    ref: 'shop.later',
    app: () => {
      const reaction = defineReaction(
        shopBase as never,
        { on: 'shop.widget.created', react: () => ({ events: [] }) } as never,
      );
      return appOf([
        makeModule({ id: 'shop', entities: { widget } }, { reactions: { later: reaction } }),
      ]);
    },
  },
  {
    name: 'a field whose column is a system column',
    code: 'columnCollisions',
    ref: 'shop.widget.createdAt',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: {
            widget: defineEntity({ prefix: 'wdg', fields: { createdAt: field.instant() } }),
          },
        }),
      ]),
  },
  {
    name: 'a fill for a point nobody declares',
    code: 'unknownExtensionPoints',
    ref: 'shop.nowhere',
    app: () => appOf([shop, contributor('extra', {}, { extensionPoints: { nowhere: [1] } })]),
  },
  {
    name: 'a single point with two fillers',
    code: 'singleExtensionPointFillers',
    ref: 'host.slot',
    app: () => {
      const host = makeModule({
        id: 'host',
        extensionPoints: { slot: extensionPoint.single<number>() },
      });
      const filler = (id: string): AnyModule =>
        makeModule(
          { id, requires: [host], contributions: { toHost: contributionTo(host, {}) } },
          { contributes: { toHost: { extensionPoints: { slot: [1] } } } },
        );
      return appOf([host, filler('one'), filler('two')]);
    },
  },
  {
    name: 'a schedule that invokes a query',
    code: 'unknownScheduleActions',
    ref: 'shop.tick',
    app: () => {
      const find = query();
      const tick = defineSchedule(shopBase as never, { every: '5m', invoke: find } as never);
      return appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { find }, schedules: { tick } },
        ),
      ]);
    },
  },
  {
    name: 'a schedule that invokes a part no module mounts',
    code: 'unresolvedPartReferences',
    ref: 'shop.tick',
    app: () => {
      const tick = defineSchedule(shopBase as never, { every: '5m', invoke: command() } as never);
      return appOf([makeModule({ id: 'shop', entities: { widget } }, { schedules: { tick } })]);
    },
  },
];
describe('compose (sections 3.3 and 4.7)', () => {
  describe('each named check fails on a tuple built in JavaScript', () => {
    test.each(appLevel)('$code: $name', ({ code, ref, app }) => {
      const problems = buildRegistry(app()).problems;
      const found = problems.filter(
        (problem) => problem.code === code && problem.severity === 'error',
      );
      expect(found.length).toBeGreaterThan(0);
      if (ref !== undefined) expect(found.map((problem) => problem.ref)).toContain(ref);
    });

    test.each(appLevel)(
      '$code: composeApp refuses with a named problem, not a string ($name)',
      ({ code, app }) => {
        let thrown: unknown;
        try {
          composeApp(app());
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(KeelwerkError);
        const details = (thrown as KeelwerkError).details as CompositionProblem;
        expect((thrown as KeelwerkError).code).toBe('core.internal');
        expect(details.severity).toBe('error');
        expect(details.code).toBe(firstRefusal[code] ?? code);
      },
    );
  });

  describe('a sound tuple composes without an error', () => {
    test.each(passing)('$name', ({ app }) => {
      const registry = buildRegistry(app());
      expect(registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
      expect(composeApp(app())).toBeDefined();
    });
  });

  test('defineApp refuses the same apps at runtime when the compiler is bypassed', () => {
    expect(() => defineApp({ id: 'broken', modules: [teams, teams] as never })).toThrow(
      /duplicateModuleIds/,
    );
  });
});
