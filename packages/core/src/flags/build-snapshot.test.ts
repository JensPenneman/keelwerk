import { describe, expect, test } from 'vitest';
import { snapshotInput, snapshotRegistry, snapshotScope } from '../../test/flag-snapshot-kit.ts';
import { effectiveRules } from '../authorization/effective-rules.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';
import { buildSnapshot } from './build-snapshot.ts';
import { envFlagProvider } from './env-flag-provider.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagProvider } from './flag-provider.ts';

const payAction = { ref: 'shop.pay', module: 'shop', name: 'pay', kind: 'command' } as ActionEntry;

function flagsOf(...names: readonly string[]): ModuleEntry['flags'] {
  return Object.fromEntries(
    names.map((name) => [name, { kind: 'boolean', level: 'tenant', default: false }]),
  );
}

function moduleOf(id: string, extra: Partial<ModuleEntry> = {}): ModuleEntry {
  const base = snapshotRegistry.modules.find((entry) => entry.id === 'other') as ModuleEntry;
  return { ...base, id, requires: [], flags: {}, ...extra };
}

function ruleOf(id: string, module: string, extra: Partial<RuleEntry>): RuleEntry {
  return {
    id,
    module,
    effect: 'deny',
    reason: 'held',
    subject: { module: 'shop' },
    actions: ['pay'],
    disabled: false,
    ...extra,
  } as RuleEntry;
}

/** The snapshot registry with its own module entries and rules, the rules of the core and the others left out. */
function registryWith(modules: readonly ModuleEntry[], rules: readonly RuleEntry[]): Registry {
  const shop = snapshotRegistry.modules.find((entry) => entry.id === 'shop') as ModuleEntry;
  return {
    ...snapshotRegistry,
    modules: [shop, ...modules],
    rules: new Map(rules.map((rule) => [rule.id, rule])),
  };
}

function remoteProvider(asked: string[]): FlagProvider {
  return {
    id: 'remote',
    sync: false,
    start: () => Promise.resolve(),
    resolve: <T>(flag: { readonly key: string }) => {
      asked.push(flag.key);
      return Promise.resolve({
        value: true,
        variant: 'true',
        reason: 'STATIC',
        provider: 'remote',
      } as never as T);
    },
  };
}

describe('buildSnapshot', () => {
  test('synchronous providers resolve a flag on its first read, once', async () => {
    let asked = 0;
    const counting: FlagProvider = {
      id: 'counting',
      sync: true,
      start: () => Promise.resolve(),
      resolve: <T>(flag: { readonly key: string }) => {
        asked++;
        return flag.key === 'shop.checkout'
          ? ({ value: true, variant: 'true', reason: 'STATIC', provider: 'counting' } as never as T)
          : undefined;
      },
    };
    const { input: built } = snapshotInput([counting]);
    const snapshot = await buildSnapshot(built);
    expect(asked).toBe(0);
    expect(snapshot.read('shop.checkout')).toMatchObject({ value: true, provider: 'counting' });
    snapshot.read('shop.checkout');
    expect(asked).toBe(1);
  });

  test('a flag flipped in its provider after the first read is not seen by the same snapshot', async () => {
    const variable = 'KEELWERK_FLAG_SHOP_CHECKOUT';
    const env: Record<string, string | undefined> = Object.fromEntries([[variable, 'true']]);
    const { input: built } = snapshotInput([envFlagProvider(env)]);
    const snapshot = await buildSnapshot(built);
    expect(snapshot.read('shop.checkout')).toMatchObject({ value: true });
    env[variable] = 'false';
    expect(snapshot.read('shop.checkout')).toMatchObject({ value: true });
    expect((await buildSnapshot(built)).read('shop.checkout')).toMatchObject({ value: false });
  });

  test('with an asynchronous provider the flags the invoked module can read are resolved before the snapshot is answered', async () => {
    const asked: string[] = [];
    const remote: FlagProvider = {
      id: 'remote',
      sync: false,
      start: () => Promise.resolve(),
      resolve: <T>(flag: { readonly key: string }) => {
        asked.push(flag.key);
        return Promise.resolve({
          value: true,
          variant: 'true',
          reason: 'STATIC',
          provider: 'remote',
        } as never as T);
      },
    };
    const { input: built } = snapshotInput([remote]);
    const snapshot = await buildSnapshot({
      ...built,
      principal: { ...placeholderPrincipal(snapshotScope), kind: 'user', subject: 'u1' } as never,
    });
    expect([...asked].sort()).toEqual(['shop.banner', 'shop.beta', 'shop.checkout']);
    expect(snapshot.evaluations).toEqual([]);
    expect(snapshot.read('shop.checkout')).toMatchObject({ value: true, provider: 'remote' });
    expect(snapshot.read('other.unrelated')).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'GENERAL',
    });
    expect(asked).toHaveLength(3);
  });

  test('with an asynchronous provider the flags of a module whose rule covers the action are resolved before the snapshot is answered', async () => {
    const asked: string[] = [];
    const registry = registryWith(
      [
        moduleOf('other', { requires: ['third'], flags: flagsOf('unrelated') }),
        moduleOf('third', { flags: flagsOf('held') }),
        moduleOf('relay', { flags: flagsOf('on') }),
      ],
      [
        ruleOf('other.shop.denyPay', 'other', { principal: 'service' }),
        ruleOf('relay.selector.allowPay', 'relay', {
          effect: 'allow',
          subject: { kinds: ['command'], transports: ['http'] },
        }),
      ],
    );
    const { input: built } = snapshotInput([remoteProvider(asked)]);
    const snapshot = await buildSnapshot({
      ...built,
      registry,
      rules: effectiveRules(registry),
      action: payAction,
      principal: { ...placeholderPrincipal(snapshotScope), kind: 'user', subject: 'u1' } as never,
    });
    expect([...asked].sort()).toEqual([
      'other.unrelated',
      'relay.on',
      'shop.banner',
      'shop.beta',
      'shop.checkout',
      'third.held',
    ]);
    expect(snapshot.evaluations).toEqual([]);
    expect(snapshot.read('other.unrelated')).toMatchObject({ value: true, provider: 'remote' });
    expect(snapshot.evaluations.map((read) => read.key)).toEqual(['other.unrelated']);
  });

  test('with an asynchronous provider a rule that does not cover the action, a disabled rule and the core default rules add no flag', async () => {
    const asked: string[] = [];
    const core = snapshotRegistry.modules.find((entry) => entry.id === 'core') as ModuleEntry;
    const registry = registryWith(
      [{ ...core, flags: flagsOf('quiet') }, moduleOf('other', { flags: flagsOf('unrelated') })],
      [
        ruleOf('other.shop.denyRefund', 'other', { actions: ['refund'] }),
        ruleOf('other.selector.denyQuery', 'other', { subject: { kinds: ['query'] } }),
        ruleOf('other.cart.denyPay', 'other', { subject: { module: 'shop', entity: 'cart' } }),
        ruleOf('other.shop.disabled', 'other', { disabled: true }),
      ],
    );
    const { input: built } = snapshotInput([remoteProvider(asked)]);
    const snapshot = await buildSnapshot({
      ...built,
      registry,
      rules: effectiveRules(registry),
      action: payAction,
      principal: { ...placeholderPrincipal(snapshotScope), kind: 'user', subject: 'u1' } as never,
    });
    expect([...asked].sort()).toEqual(['shop.banner', 'shop.beta', 'shop.checkout']);
    expect(snapshot.read('other.unrelated')).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'GENERAL',
    });
  });

  test("an anonymous principal's targeting key is the client id", async () => {
    const keys: (string | null)[] = [];
    const spy: FlagProvider = {
      id: 'spy',
      sync: true,
      start: () => Promise.resolve(),
      resolve: (_flag, context: FlagContext) => {
        keys.push(context.targetingKey);
        return undefined;
      },
    };
    const { input: built } = snapshotInput([spy]);
    const snapshot = await buildSnapshot({ ...built, clientId: 'client-1' });
    expect(snapshot.read('shop.beta')).toMatchObject({ reason: 'DEFAULT' });
    expect(snapshot.read('shop.checkout')).toMatchObject({ reason: 'DEFAULT' });
    expect(keys).toEqual(['client-1', 't1']);
    const without = await buildSnapshot(built);
    expect(without.read('shop.beta')).toMatchObject({
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
    });
  });

  test('evaluations list each key once, in read order', async () => {
    const { input: built } = snapshotInput([]);
    const snapshot = await buildSnapshot(built);
    snapshot.read('shop.banner');
    snapshot.read('shop.checkout');
    snapshot.read('shop.banner');
    expect(snapshot.evaluations).toEqual([
      { key: 'shop.banner', variant: 'hi', reason: 'DEFAULT', ruleVersion: null },
      { key: 'shop.checkout', variant: 'false', reason: 'DEFAULT', ruleVersion: null },
    ]);
  });

  test('an unknown key answers FLAG_NOT_FOUND and is not listed', async () => {
    const { input: built } = snapshotInput([]);
    const snapshot = await buildSnapshot(built);
    expect(snapshot.read('shop.nothing')).toEqual({
      value: undefined,
      variant: 'default',
      reason: 'ERROR',
      errorCode: 'FLAG_NOT_FOUND',
      provider: 'default',
    });
    expect(snapshot.evaluations).toEqual([]);
  });

  test('a provider that fails serves the default with ERROR and logs at error level once per key', async () => {
    const failing: FlagProvider = {
      id: 'failing',
      sync: true,
      start: () => Promise.resolve(),
      resolve: () => {
        throw new Error('down');
      },
    };
    const { input: built, warnings } = snapshotInput([failing]);
    const snapshot = await buildSnapshot(built);
    expect(snapshot.read('shop.checkout')).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'GENERAL',
      provider: 'failing',
    });
    snapshot.read('shop.checkout');
    expect(warnings).toEqual([{ flag: 'shop.checkout', provider: 'failing', error: 'down' }]);
  });

  test('a provider that declares sync and returns a promise answers ERROR/GENERAL', async () => {
    const liar: FlagProvider = {
      id: 'liar',
      sync: true,
      start: () => Promise.resolve(),
      resolve: () => Promise.reject(new Error('late')),
    };
    const { input: built } = snapshotInput([liar]);
    const snapshot = await buildSnapshot(built);
    expect(snapshot.read('shop.checkout')).toMatchObject({
      reason: 'ERROR',
      errorCode: 'GENERAL',
      provider: 'liar',
    });
  });

  test('the snapshot awaits targeting.fresh() before it resolves', async () => {
    const order: string[] = [];
    const provider: FlagProvider = {
      id: 'late',
      sync: false,
      start: () => Promise.resolve(),
      resolve: () => {
        order.push('resolve');
        return Promise.resolve(undefined);
      },
    };
    const { input: built } = snapshotInput([provider]);
    await buildSnapshot({
      ...built,
      targeting: {
        fresh: async () => {
          await Promise.resolve();
          order.push('fresh');
        },
      },
    });
    expect(order[0]).toBe('fresh');
  });
});
