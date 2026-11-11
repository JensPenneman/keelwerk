import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { Scope } from '../storage/scope.ts';
import { principalContextOf } from './principal-context-of.ts';

const registry = buildRegistry(
  appOf([
    makeModule({
      id: 'shop',
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
          level: 'tenant',
          purpose: 'operational',
        }),
        limit: defineFlag({ kind: 'number', default: 5, level: 'tenant', purpose: 'operational' }),
      },
    }),
  ]),
);
const scope: Scope = { level: 'deployment' };
const principal = placeholderPrincipal(scope);

describe('principalContextOf', () => {
  test('without a snapshot the flags are the declared defaults', () => {
    const { flags } = principalContextOf(registry, principal, scope);
    expect(flags.shop).toEqual({ checkout: false, banner: 'hi' });
    expect(flags.core).toEqual({});
  });

  test('with a snapshot a flag is read only when a rule touches it', () => {
    const read: string[] = [];
    const snapshot: FlagSnapshot = {
      read: <T>(key: string): FlagResolution<T> => {
        read.push(key);
        const value = key === 'shop.checkout' ? true : 'sale';
        return {
          value,
          variant: String(value),
          reason: 'STATIC',
          provider: 'test',
        } as FlagResolution<T>;
      },
      evaluations: [],
    };
    const { flags } = principalContextOf(registry, principal, scope, snapshot);
    expect(read).toEqual([]);
    expect(flags.shop?.checkout).toBe(true);
    expect(read).toEqual(['shop.checkout']);
    expect(Object.keys(flags.shop ?? {})).toEqual(['checkout', 'banner']);
    expect(flags.shop?.banner).toBe('sale');
    expect(read).toEqual(['shop.checkout', 'shop.banner']);
  });
});
