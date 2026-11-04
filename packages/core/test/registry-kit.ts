import { core } from '../src/core-module/module.ts';
import { defineCommand } from '../src/dsl/define-command.ts';
import { defineContribution } from '../src/dsl/define-contribution.ts';
import { defineEntity } from '../src/dsl/define-entity.ts';
import { defineModule } from '../src/dsl/define-module.ts';
import { defineModuleBase } from '../src/dsl/define-module-base.ts';
import { defineQuery } from '../src/dsl/define-query.ts';
import { defineReaction } from '../src/dsl/define-reaction.ts';
import { defineRule } from '../src/dsl/define-rule.ts';
import { field } from '../src/fields/field.ts';
import type { AnyModule } from '../src/model/any-module.ts';
import type { ComposableApp } from '../src/registry/composable-app.ts';

/** A module built without the compile-time checks: the way a JavaScript caller or a dynamic tuple builds one. */
export function makeModule(base: object, literal: object = {}): AnyModule {
  const checked = defineModuleBase({ version: '0.1.0', ...base } as never);
  return defineModule(checked, literal as never) as unknown as AnyModule;
}

/** An app value built without `defineApp`, so nothing refuses it before `compose` sees it. */
export function appOf(
  modules: readonly AnyModule[],
  options: Partial<ComposableApp> = {},
): ComposableApp {
  return {
    kind: 'app',
    id: 'subject',
    modules: [core, ...modules],
    execution: {},
    appActions: {},
    authorization: {},
    policies: {},
    api: null,
    ...options,
  };
}

export const widget = defineEntity({ prefix: 'wdg', fields: { name: field.string() } });
export const shop = makeModule({ id: 'shop', entities: { widget } });
export const shopBase = (shop as unknown as { readonly base: object }).base;

export const grant = (target: string, actions: readonly string[]): object =>
  defineRule(
    shopBase as never,
    target as never,
    {
      effect: 'allow',
      actions,
      principal: 'user',
    } as never,
  );

export const noop = (): undefined => undefined;
export const command = (spec: object = {}): object =>
  defineCommand(shopBase as never, { decide: () => ({ events: [] }), ...spec } as never);
export const query = (): object => defineQuery(shopBase as never, { read: noop } as never);
export const contributionTo = (target: AnyModule, spec: object): object =>
  defineContribution(target as never, spec as never);

/** A module that contributes `entities` to `shop`, with the behaviour half under the same key. */
export function contributor(
  id: string,
  entities: object,
  behaviour: object = {},
  base: object = {},
) {
  return makeModule(
    {
      id,
      requires: [shop],
      contributions: { toShop: contributionTo(shop, { entities }) },
      ...base,
    },
    { contributes: { toShop: behaviour } },
  );
}

export const optionalName = { widget: { fields: { extra: field.string().optional() } } };

export const addedRule = {
  id: 'app.extra',
  module: 'app',
  effect: 'allow',
  subject: { module: 'shop', entity: 'widget' },
  actions: ['read'],
  disabled: false,
};

export function shopWithRule(spec: object = { actions: ['read'] }): AnyModule {
  return makeModule(
    { id: 'shop', entities: { widget } },
    {
      policies: {
        widget: {
          rule: defineRule(
            shopBase as never,
            'widget' as never,
            { effect: 'allow', ...spec } as never,
          ),
        },
      },
    },
  );
}

export function reactionPair(): readonly AnyModule[] {
  const reaction = (base: object): object =>
    defineReaction(
      base as never,
      { on: 'shop.widget.created', timing: 'inline', react: () => ({ events: [] }) } as never,
    );
  const own = makeModule(
    { id: 'shop', entities: { widget } },
    { reactions: { notify: reaction(shopBase) } },
  );
  const extra = makeModule(
    { id: 'extra', requires: [own], contributions: { toShop: contributionTo(own, {}) } },
    { contributes: { toShop: { reactions: { notify: reaction(shopBase) } } } },
  );
  return [own, extra];
}

export interface Case {
  readonly name: string;
  readonly code: string;
  readonly ref?: string;
  readonly app: () => ComposableApp;
}
