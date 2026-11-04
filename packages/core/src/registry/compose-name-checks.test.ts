import { describe, expect, test } from 'vitest';
import {
  appOf,
  type Case,
  command,
  contributionTo,
  makeModule,
  query,
  shop,
  widget,
} from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { field } from '../fields/field.ts';
import { relation } from '../fields/relation.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';

const naming: readonly Case[] = [
  {
    name: 'two modules with one id',
    code: 'duplicateModuleIds',
    ref: 'shop',
    app: () => appOf([shop, shop]),
  },
  {
    name: 'a module called app',
    code: 'reservedModuleIds',
    ref: 'app',
    app: () => appOf([makeModule({ id: 'app' })]),
  },
  {
    name: 'a module called core',
    code: 'reservedModuleIds',
    ref: 'core',
    app: () => appOf([makeModule({ id: 'core' })]),
  },
  {
    name: 'a malformed module id',
    code: 'invalidModuleIds',
    ref: 'Bad_Id',
    app: () => appOf([makeModule({ id: 'Bad_Id' })]),
  },
  { name: 'a malformed app id', code: 'invalidAppId', app: () => appOf([], { id: 'Bad App' }) },
  {
    name: 'two ids that camel-case alike',
    code: 'camelCaseCollisions',
    ref: 'mail2fa',
    app: () => appOf([makeModule({ id: 'mail-2fa' }), makeModule({ id: 'mail2fa' })]),
  },
  {
    name: 'a dependency cycle',
    code: 'dependencyCycles',
    app: () => {
      const first = makeModule({ id: 'first' });
      const second = makeModule({ id: 'second', requires: [first] });
      Object.assign(first, { requires: [second] });
      return appOf([first, second]);
    },
  },
  {
    name: 'two entities with one prefix',
    code: 'duplicatePrefixes',
    ref: 'wdg',
    app: () =>
      appOf([
        shop,
        makeModule({
          id: 'other',
          entities: { gizmo: defineEntity({ prefix: 'wdg', fields: { name: field.string() } }) },
        }),
      ]),
  },
  {
    name: 'a custom action named like a generated one',
    code: 'reservedActionNames',
    ref: 'shop.widget',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { entityActions: { widget: { create: command() } } },
        ),
      ]),
  },
  {
    name: 'a domain event named like a generated one',
    code: 'reservedEventNames',
    ref: 'shop.widget',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: {
            widget: defineEntity({
              prefix: 'wdg',
              fields: { name: field.string() },
              events: { created: shape({}) },
            }),
          },
        }),
      ]),
  },
  {
    name: 'a field named like a filter operator',
    code: 'reservedFieldNames',
    ref: 'shop.widget',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: { widget: defineEntity({ prefix: 'wdg', fields: { not: field.string() } }) },
        }),
      ]),
  },
  {
    name: 'a name outside the identifier grammar',
    code: 'invalidActionName',
    ref: 'shop.Bad_Name',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: Object.fromEntries([['Bad_Name', query()]]) },
        ),
      ]),
  },
  {
    name: 'a relation name outside the identifier grammar',
    code: 'invalidRelationName',
    ref: 'shop.widget.Bad_Rel',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: {
            widget: defineEntity({
              prefix: 'wdg',
              fields: { name: field.string() },
              relations: Object.fromEntries([
                ['Bad_Rel', relation.one.own('widget', { by: 'id', to: 'id' })],
              ]),
            }),
          },
        }),
      ]),
  },
  {
    name: 'an event name outside the identifier grammar',
    code: 'invalidEventName',
    ref: 'shop.widget.Bad_Event',
    app: () =>
      appOf([
        makeModule({
          id: 'shop',
          entities: {
            widget: defineEntity({
              prefix: 'wdg',
              fields: { name: field.string() },
              events: Object.fromEntries([['Bad_Event', shape({})]]),
            }),
          },
        }),
      ]),
  },
  {
    name: 'an entity and a module action of one name',
    code: 'duplicateNames',
    ref: 'shop.widget',
    app: () =>
      appOf([makeModule({ id: 'shop', entities: { widget } }, { actions: { widget: query() } })]),
  },
  {
    name: 'a contributed action that replaces an own one',
    code: 'duplicateActions',
    ref: 'shop.widget.refund',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { entityActions: { widget: { refund: command() } } },
        ),
        makeModule(
          {
            id: 'extra',
            requires: [shop],
            contributions: {
              toShop: contributionTo(shop, { entities: { widget: { fields: {} } } }),
            },
          },
          { contributes: { toShop: { entityActions: { widget: { refund: command() } } } } },
        ),
      ]),
  },
];

describe('the naming and identity checks, mirrored at compose (sections 5.1 and 4.7)', () => {
  test.each(naming)('$code: $name', ({ code, ref, app }) => {
    const found = buildRegistry(app()).problems.filter(
      (problem) => problem.code === code && problem.severity === 'error',
    );
    expect(found.length).toBeGreaterThan(0);
    if (ref !== undefined) expect(found.map((problem) => problem.ref)).toContain(ref);
  });

  test('a structural problem leaves an empty registry beside the problems', () => {
    const registry = buildRegistry(appOf([shop, shop]));
    expect(registry.modules).toEqual([]);
    expect(registry.entities.size).toBe(0);
    expect(registry.problems.map((problem) => problem.code)).toContain('duplicateModuleIds');
  });
});
