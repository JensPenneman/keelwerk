import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { recordedFlagSnapshot } from './recorded-flag-snapshot.ts';

const registry = buildRegistry(
  appOf([
    makeModule({
      id: 'shop',
      flags: {
        checkout: defineFlag({
          kind: 'boolean',
          default: false,
          level: 'tenant',
          purpose: 'operational',
        }),
        limit: defineFlag({ kind: 'number', default: 5, level: 'tenant', purpose: 'operational' }),
        banner: defineFlag({
          kind: 'string',
          default: 'hi',
          level: 'tenant',
          purpose: 'operational',
        }),
        theme: defineFlag({
          kind: 'variant',
          variants: ['light', 'dark'],
          default: 'light',
          level: 'tenant',
          purpose: 'operational',
        }),
        layout: defineFlag({
          kind: 'json',
          schema: shape({ columns: field.integer() }),
          default: { columns: 2 },
          level: 'tenant',
          purpose: 'operational',
        }),
      },
    }),
  ]),
);

describe('recordedFlagSnapshot', () => {
  test("an M1 read { variant: 'false', reason: 'DEFAULT', ruleVersion: null } answers false from provider default", () => {
    const snapshot = recordedFlagSnapshot(registry, [
      { key: 'shop.checkout', variant: 'false', reason: 'DEFAULT', ruleVersion: null },
    ]);
    expect(snapshot.read('shop.checkout')).toEqual({
      value: false,
      variant: 'false',
      reason: 'DEFAULT',
      provider: 'default',
    });
    expect(snapshot.evaluations).toEqual([
      { key: 'shop.checkout', variant: 'false', reason: 'DEFAULT', ruleVersion: null },
    ]);
  });

  test('boolean, number, string and variant reads decode by kind', () => {
    const snapshot = recordedFlagSnapshot(registry, [
      { key: 'shop.checkout', variant: 'true', reason: 'STATIC', ruleVersion: 3 },
      { key: 'shop.limit', variant: '12', reason: 'STATIC', ruleVersion: null },
      { key: 'shop.banner', variant: 'sale', reason: 'STATIC', ruleVersion: null },
      { key: 'shop.theme', variant: 'dark', reason: 'STATIC', ruleVersion: null },
    ]);
    expect(snapshot.read('shop.checkout')).toMatchObject({
      value: true,
      reason: 'STATIC',
      ruleVersion: 3,
      provider: 'record',
    });
    expect(snapshot.read('shop.limit')).toMatchObject({ value: 12, variant: '12' });
    expect(snapshot.read('shop.banner')).toMatchObject({ value: 'sale' });
    expect(snapshot.read('shop.theme')).toMatchObject({ value: 'dark', variant: 'dark' });
  });

  test('a json read other than default is replay unsupported', () => {
    const same = recordedFlagSnapshot(registry, [
      { key: 'shop.layout', variant: 'default', reason: 'DEFAULT', ruleVersion: null },
    ]);
    expect(same.read('shop.layout')).toMatchObject({ value: { columns: 2 } });
    const other = recordedFlagSnapshot(registry, [
      { key: 'shop.layout', variant: 'env', reason: 'STATIC', ruleVersion: null },
    ]);
    expect(() => other.read('shop.layout')).toThrow(/shop\.layout.*env/);
    const garbled = recordedFlagSnapshot(registry, [
      { key: 'shop.checkout', variant: 'maybe', reason: 'STATIC', ruleVersion: null },
    ]);
    expect(() => garbled.read('shop.checkout')).toThrow(/shop\.checkout/);
  });

  test('an unrecorded key answers its default', () => {
    const snapshot = recordedFlagSnapshot(registry, []);
    expect(snapshot.read('shop.limit')).toMatchObject({ value: 5, reason: 'DEFAULT' });
    expect(snapshot.read('shop.nothing')).toMatchObject({ errorCode: 'FLAG_NOT_FOUND' });
    expect(snapshot.evaluations).toEqual([
      { key: 'shop.limit', variant: '5', reason: 'DEFAULT', ruleVersion: null },
    ]);
  });
});
