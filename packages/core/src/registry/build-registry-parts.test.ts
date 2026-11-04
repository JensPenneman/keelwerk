import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import {
  appOf,
  command,
  contributionTo,
  makeModule,
  shopBase,
  widget,
} from '../../test/registry-kit.ts';
import { core } from '../core-module/module.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineHook } from '../dsl/define-hook.ts';
import { defineSchedule } from '../dsl/define-schedule.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from './build-registry.ts';

const fullApp = defineApp({ id: 'full', modules: [accounts, teams, auth, hooks] });
const full = buildRegistry(fullApp);

describe('services, hooks, effects, executors and schedules', () => {
  test('services, effects and executors are listed by reference', () => {
    expect(full.services.get('accounts.findByEmail')).toMatchObject({ module: 'accounts' });
    expect(full.effects.get('hooks.post')).toEqual({
      ref: 'hooks.post',
      module: 'hooks',
      name: 'post',
      performer: 'executor',
      executor: 'hooks.post',
    });
    expect(full.executors.get('hooks.post')).toMatchObject({
      effect: 'hooks.post',
      queue: 'effects',
      inline: true,
      capability: [],
    });
  });

  test('a lifecycle hook runs at the level of its name (S-27)', () => {
    const base = shopBase as never;
    const registry = buildRegistry(
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          {
            lifecycle: {
              seedTeam: defineHook(base, 'onTenantCreated', () => []),
              seedRoot: defineHook(base, 'onBackendCreated', () => []),
              wind: defineHook(base, 'onTenantArchived', () => []),
            },
          },
        ),
      ]),
    );
    expect([...registry.hooks.values()].map((hook) => [hook.id, hook.hook, hook.unit])).toEqual([
      ['shop.seedRoot', 'onBackendCreated', 'backend'],
      ['shop.seedTeam', 'onTenantCreated', 'tenant'],
      ['shop.wind', 'onTenantArchived', 'tenant'],
    ]);
  });

  test('an unknown hook name is the problem unknownHooks, a known one is not', () => {
    const base = shopBase as never;
    const build = (hook: string): readonly string[] =>
      buildRegistry(
        appOf([
          makeModule(
            { id: 'shop', entities: { widget } },
            { lifecycle: { seed: defineHook(base, hook as 'onTenantCreated', () => []) } },
          ),
        ]),
      ).problems.map((problem) => problem.code);
    expect(build('onTenantRetired')).toContain('unknownHooks');
    expect(build('onTenantCreated')).not.toContain('unknownHooks');
  });

  test('a schedule names the command it invokes', () => {
    const refresh = command();
    const tick = defineSchedule(
      shopBase as never,
      {
        every: '5m',
        invoke: refresh,
        scope: 'each-tenant',
        jitter: '30s',
      } as never,
    );
    const registry = buildRegistry(
      appOf([
        makeModule(
          { id: 'shop', entities: { widget } },
          { actions: { refresh }, schedules: { tick } },
        ),
      ]),
    );
    expect(registry.schedules.get('shop.tick')).toEqual({
      ref: 'shop.tick',
      module: 'shop',
      name: 'tick',
      every: '5m',
      invoke: 'shop.refresh',
      scope: 'each-tenant',
      jitter: '30s',
    });
  });
});

describe('extension points and fills (section 5.5)', () => {
  test('lists the points the modules declare, including the core ones', () => {
    expect([...full.extensionPoints.keys()]).toEqual([
      'accounts.identityProviders',
      'core.invocationMiddleware',
      'core.principalEnrichers',
      'core.principalResolvers',
      'core.transports',
    ]);
    expect(full.extensionPoints.get('core.principalResolvers')).toMatchObject({
      mode: 'ordered',
      hasDefault: false,
    });
  });

  test('a fill made with defineFill is bound to its contributor, a plain value is not', () => {
    const [bound] = full.fills.get('accounts.identityProviders') ?? [];
    expect(bound).toMatchObject({
      point: 'accounts.identityProviders',
      module: 'auth',
      bound: true,
    });
    expect(typeof bound?.fill).toBe('function');
    const host = makeModule({
      id: 'host',
      extensionPoints: { slot: extensionPoint.set<number>() },
    });
    const filler = makeModule(
      { id: 'filler', requires: [host], contributions: { toHost: contributionTo(host, {}) } },
      { contributes: { toHost: { extensionPoints: { slot: [1, 2] } } } },
    );
    const plain = buildRegistry(appOf([host, filler])).fills.get('host.slot') ?? [];
    expect(plain).toMatchObject([
      { module: 'filler', bound: false, fill: 1 },
      { module: 'filler', bound: false, fill: 2 },
    ]);
  });

  test('ordered points sort by declared order, then module order', () => {
    const host = makeModule({
      id: 'host',
      extensionPoints: { slot: extensionPoint.ordered<object>() },
    });
    const filler = (id: string, order: number): AnyModule =>
      makeModule(
        { id, requires: [host], contributions: { toHost: contributionTo(host, {}) } },
        { contributes: { toHost: { extensionPoints: { slot: { order } } } } },
      );
    const registry = buildRegistry(
      appOf([host, filler('late', 2), filler('early', 1), filler('also', 1)]),
    );
    expect((registry.fills.get('host.slot') ?? []).map((fill) => fill.module)).toEqual([
      'early',
      'also',
      'late',
    ]);
  });

  test('an empty slot below min is a warning for the kernel to refuse at boot', () => {
    const host = makeModule({
      id: 'host',
      extensionPoints: { slot: extensionPoint.set<number>({ min: 1 }) },
    });
    const registry = buildRegistry(appOf([host]));
    expect(registry.problems).toEqual([
      expect.objectContaining({
        code: 'emptyExtensionPoints',
        severity: 'warning',
        ref: 'host.slot',
      }),
    ]);
  });
});

test('the core is the first module of every registry', () => {
  expect(buildRegistry(appOf([])).modules.map((module) => module.id)).toEqual(['core']);
  expect(core.id).toBe('core');
});
