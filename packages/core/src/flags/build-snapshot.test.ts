import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import type { Logger } from '../observability/logger.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { Scope } from '../storage/scope.ts';
import { buildSnapshot } from './build-snapshot.ts';
import { envFlagProvider } from './env-flag-provider.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagProvider } from './flag-provider.ts';

const registry = buildRegistry(
  appOf([
    makeModule({
      id: 'shop',
      gate: 'checkout',
      flags: {
        checkout: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'tenant',
          purpose: 'release',
          expires: '2027-06-30',
        }),
        banner: defineFlag({
          kind: 'string',
          default: 'hi',
          level: 'backend',
          purpose: 'operational',
        }),
        beta: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'principal',
          purpose: 'permission',
        }),
      },
    }),
    makeModule({
      id: 'other',
      flags: {
        unrelated: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'tenant',
          purpose: 'operational',
        }),
      },
    }),
  ]),
);
const action = { ref: 'shop.pay', module: 'shop' } as ActionEntry;
const scope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };

function capture(): { readonly log: Logger; readonly warnings: unknown[] } {
  const warnings: unknown[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (_message, fields) => {
      warnings.push(fields);
    },
    error: () => undefined,
    child: () => log,
  };
  return { log, warnings };
}

function input(
  providers: readonly FlagProvider[],
  principal: Principal = placeholderPrincipal(scope),
) {
  const { log, warnings } = capture();
  return {
    warnings,
    input: { registry, action, scope, principal, clientId: null, providers, log },
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
    const { input: built } = input([counting]);
    const snapshot = await buildSnapshot(built);
    expect(asked).toBe(0);
    expect(snapshot.read('shop.checkout')).toMatchObject({ value: true, provider: 'counting' });
    snapshot.read('shop.checkout');
    expect(asked).toBe(1);
  });

  test('a flag flipped in its provider after the first read is not seen by the same snapshot', async () => {
    const variable = 'KEELWERK_FLAG_SHOP_CHECKOUT';
    const env: Record<string, string | undefined> = Object.fromEntries([[variable, 'true']]);
    const { input: built } = input([envFlagProvider(env)]);
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
    const { input: built } = input([remote]);
    const snapshot = await buildSnapshot({
      ...built,
      principal: { ...placeholderPrincipal(scope), kind: 'user', subject: 'u1' } as never,
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
    const { input: built } = input([spy]);
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
    const { input: built } = input([]);
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
    const { input: built } = input([]);
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

  test('a provider that fails serves the default with ERROR and warns once per key', async () => {
    const failing: FlagProvider = {
      id: 'failing',
      sync: true,
      start: () => Promise.resolve(),
      resolve: () => {
        throw new Error('down');
      },
    };
    const { input: built, warnings } = input([failing]);
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
    const { input: built } = input([liar]);
    const snapshot = await buildSnapshot(built);
    expect(snapshot.read('shop.checkout')).toMatchObject({
      reason: 'ERROR',
      errorCode: 'GENERAL',
      provider: 'liar',
    });
  });
});
