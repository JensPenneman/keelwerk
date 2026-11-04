import { describe, expect, test } from 'vitest';
import { hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import {
  appOf,
  type Case,
  contributionTo,
  contributor,
  grant,
  makeModule,
  optionalName,
  shop,
  shopBase,
  widget,
} from '../../test/registry-kit.ts';
import { core } from '../core-module/module.ts';
import { defineEffect } from '../dsl/define-effect.ts';
import { defineEffectExecutor } from '../dsl/define-effect-executor.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineRule } from '../dsl/define-rule.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from './build-registry.ts';

const moduleLevel: readonly Case[] = [
  {
    name: 'a reference outside the requirements',
    code: 'refsOutsideRequirements',
    ref: 'user.note.about',
    app: () =>
      appOf([
        shop,
        makeModule({
          id: 'user',
          optional: [shop],
          entities: {
            note: defineEntity({
              prefix: 'note',
              fields: { about: field.ref(shop as never, 'widget' as never) },
            }),
          },
        }),
      ]),
  },
  {
    name: 'a contributed field without a default',
    code: 'contributedFieldsNeedDefault',
    ref: 'extra->shop.widget.extra',
    app: () =>
      appOf([shop, contributor('extra', { widget: { fields: { extra: field.string() } } })]),
  },
  {
    name: 'a contribution to a module outside the dependencies',
    code: 'contributionsOutsideDependencies',
    ref: 'extra->shop',
    app: () => appOf([shop, contributor('extra', optionalName, {}, { requires: [] })]),
  },
  {
    name: 'a conditional part that patches an entity of another module',
    code: 'unknownConditionTargets',
    ref: 'user[later].gadget',
    app: () =>
      appOf([
        shop,
        makeModule({
          id: 'user',
          optional: [shop],
          conditions: {
            later: {
              kind: 'condition',
              when: [shop],
              entities: { gadget: { fields: {}, relations: {} } },
            },
          },
        }),
      ]),
  },
  {
    name: 'an executor mounted for no effect',
    code: 'executorsWithoutEffect',
    ref: 'shop.post',
    app: () => {
      const effect = defineEffect(shopBase as never, { input: shape({}) } as never);
      const executor = defineEffectExecutor(
        shopBase as never,
        effect as never,
        { run: async () => ({}) } as never,
      );
      return appOf([
        makeModule({ id: 'shop', entities: { widget } }, { executors: { post: executor } }),
      ]);
    },
  },
  {
    name: 'an inline executor with a capability',
    code: 'inlineExecutorCapabilities',
    ref: 'shop.post',
    app: () => {
      const effect = defineEffect(shopBase as never, { input: shape({}) } as never);
      const executor = defineEffectExecutor(
        shopBase as never,
        effect as never,
        {
          inline: true,
          capability: ['smtp-out'],
          run: async () => ({}),
        } as never,
      );
      return appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { effects: { post: effect }, executors: { post: executor } },
        ),
      ]);
    },
  },
  {
    name: 'a rule that names an action its target does not mount',
    code: 'unknownRuleActions',
    ref: 'widget.rule.refund',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { policies: { widget: { rule: grant('widget', ['refund']) } } },
        ),
      ]),
  },
  {
    name: 'a policy key that its rule does not cover',
    code: 'unknownPolicyTargets',
    ref: 'gadget.rule',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { policies: { gadget: { rule: grant('widget', ['read']) } } },
        ),
      ]),
  },
  {
    name: 'a rule condition that names an unknown field',
    code: 'unknownConditionFields',
    ref: 'shop.widget.rule',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          {
            policies: {
              widget: {
                rule: defineRule(
                  shopBase as never,
                  'widget' as never,
                  {
                    effect: 'allow',
                    actions: ['read'],
                    where: () => ({ nope: 1, or: [{ name: 'a' }, { not: { alsoNope: 2 } }] }),
                  } as never,
                ),
              },
            },
          },
        ),
      ]),
  },
  {
    name: 'a read rule that lists a field that is not maskable',
    code: 'readRuleFields',
    ref: 'shop.widget.rule',
    app: () =>
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          {
            policies: {
              widget: {
                rule: defineRule(
                  shopBase as never,
                  'widget' as never,
                  {
                    effect: 'allow',
                    actions: ['read'],
                    fields: ['name'],
                  } as never,
                ),
              },
            },
          },
        ),
      ]),
  },
];
describe('the module-level checks, mirrored at compose (section 4.7)', () => {
  test.each(moduleLevel)('$code: $name', ({ code, ref, app }) => {
    const found = buildRegistry(app()).problems.filter(
      (problem) => problem.code === code && problem.severity === 'error',
    );
    expect(found.length).toBeGreaterThan(0);
    if (ref !== undefined) expect(found.map((problem) => problem.ref)).toContain(ref);
  });

  test('a contribution to the core needs no entry in requires or optional (section 5.6)', () => {
    const tools = makeModule(
      { id: 'tools', contributions: { toCore: contributionTo(core as unknown as AnyModule, {}) } },
      { contributes: { toCore: { extensionPoints: { transports: [{ id: 'stub' }] } } } },
    );
    const problems = buildRegistry(appOf([tools])).problems;
    expect(
      problems.filter((problem) => problem.code === 'contributionsOutsideDependencies'),
    ).toEqual([]);
  });

  test('an executor mounted for its own effect is sound', () => {
    const buildHooks = buildRegistry(appOf([hooks]));
    expect(buildHooks.problems).toEqual([]);
    expect([...buildHooks.executors.keys()]).toEqual(['hooks.post']);
  });
});
