import { describe, expect, test, vi } from 'vitest';
import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagProvider } from './flag-provider.ts';
import type { FlagSpec } from './flag-spec.ts';
import { resolveFlag } from './resolve-flag.ts';

const flag: FlagSpec<boolean> = {
  key: 'shop.checkout',
  kind: 'boolean',
  level: 'tenant',
  default: false,
  purpose: 'release',
};
const context: FlagContext = {
  scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
  principal: { kind: 'anonymous', id: null, roles: [] },
  attributes: {},
  targetingKey: 't1',
};

function answer<T>(value: T, provider: string): FlagResolution<T> {
  return { value, variant: String(value), reason: 'STATIC', provider };
}

function provider(
  id: string,
  resolve: FlagProvider['resolve'],
  sync = true,
): FlagProvider & { readonly asked: { count: number } } {
  const asked = { count: 0 };
  return {
    id,
    sync,
    asked,
    start: () => Promise.resolve(),
    resolve: (spec, ctx) => {
      asked.count++;
      return resolve(spec, ctx);
    },
  };
}

describe('resolveFlag', () => {
  test('the first provider that answers wins, in chain order', () => {
    const passing = provider('a', () => undefined);
    const first = provider('b', <T>() => answer(true, 'b') as FlagResolution<T>);
    const last = provider('c', <T>() => answer(false, 'c') as FlagResolution<T>);
    expect(resolveFlag([passing, first, last], flag, context)).toMatchObject({
      value: true,
      provider: 'b',
    });
    expect(last.asked.count).toBe(0);
  });

  test('no answer serves the default with DEFAULT and provider default', () => {
    expect(resolveFlag([provider('a', () => undefined)], flag, context)).toEqual({
      value: false,
      variant: 'false',
      reason: 'DEFAULT',
      provider: 'default',
    });
    expect(resolveFlag([], flag, context)).toMatchObject({ reason: 'DEFAULT' });
  });

  test('a provider that throws or rejects serves the default with ERROR and GENERAL', async () => {
    const onError = vi.fn();
    const throwing = provider('t', () => {
      throw new Error('boom');
    });
    expect(resolveFlag([throwing], flag, context, onError)).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'GENERAL',
      provider: 't',
    });
    expect(onError).toHaveBeenCalledWith('t', expect.any(Error));
    const rejecting = provider('r', () => Promise.reject(new Error('later')), false);
    await expect(resolveFlag([rejecting], flag, context, onError)).resolves.toMatchObject({
      reason: 'ERROR',
      errorCode: 'GENERAL',
      provider: 'r',
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  test('a value of the wrong kind or an unlisted variant serves the default with TYPE_MISMATCH', () => {
    const wrong = provider('w', <T>() => answer('yes', 'w') as unknown as FlagResolution<T>);
    expect(resolveFlag([wrong], flag, context)).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'TYPE_MISMATCH',
      provider: 'w',
    });
    const theme: FlagSpec<string> = {
      key: 'shop.theme',
      kind: 'variant',
      level: 'tenant',
      default: 'light',
      variants: ['light', 'dark'],
    };
    const unlisted = provider('u', <T>() => answer('blue', 'u') as unknown as FlagResolution<T>);
    expect(resolveFlag([unlisted], theme, context)).toMatchObject({
      value: 'light',
      errorCode: 'TYPE_MISMATCH',
    });
    const infinite: FlagSpec<number> = { ...flag, kind: 'number', default: 1 };
    const nan = provider('n', <T>() => answer(Number.NaN, 'n') as unknown as FlagResolution<T>);
    expect(resolveFlag([nan], infinite, context)).toMatchObject({ errorCode: 'TYPE_MISMATCH' });
  });

  test('a principal-level flag without a targeting key answers TARGETING_KEY_MISSING and asks no provider', () => {
    const asked = provider('a', <T>() => answer(true, 'a') as FlagResolution<T>);
    const perUser: FlagSpec<boolean> = { ...flag, level: 'principal' };
    expect(resolveFlag([asked], perUser, { ...context, targetingKey: null })).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
    });
    expect(asked.asked.count).toBe(0);
    const tenantLevel = resolveFlag([asked], flag, { ...context, targetingKey: null });
    expect(tenantLevel).toMatchObject({ value: true });
  });

  test('answers synchronously while every provider does', async () => {
    const sync = provider('s', () => undefined);
    expect(resolveFlag([sync], flag, context)).not.toBeInstanceOf(Promise);
    const later = provider(
      'l',
      <T>() => Promise.resolve(answer(true, 'l') as FlagResolution<T>),
      false,
    );
    const result = resolveFlag([sync, later], flag, context);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toMatchObject({ value: true, provider: 'l' });
  });
});
