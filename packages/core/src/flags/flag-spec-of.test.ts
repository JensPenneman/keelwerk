import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { flagSpecOf } from './flag-spec-of.ts';
import { flagSpecsOf } from './flag-specs-of.ts';

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
        banner: defineFlag({
          kind: 'string',
          default: 'hi',
          level: 'backend',
          purpose: 'operational',
        }),
      },
    }),
  ]),
);

describe('flagSpecOf', () => {
  test('answers a declared flag with its key, the same object every time', () => {
    expect(flagSpecOf(registry, 'shop.banner')).toMatchObject({
      key: 'shop.banner',
      kind: 'string',
      default: 'hi',
    });
    expect(flagSpecOf(registry, 'shop.banner')).toBe(flagSpecOf(registry, 'shop.banner'));
  });

  test('answers undefined for a key nothing declares, also one that names an inherited member', () => {
    for (const key of ['shop.nothing', 'nothing.banner', 'banner', 'shop.constructor', '']) {
      expect(flagSpecOf(registry, key)).toBeUndefined();
    }
  });

  test('keys a caller makes up never add to what the registry holds', () => {
    const declared = flagSpecsOf(registry).size;
    expect(declared).toBe(2);
    for (let index = 0; index < 10_000; index++) {
      expect(flagSpecOf(registry, `shop.unknown${index}`)).toBeUndefined();
    }
    expect(flagSpecsOf(registry).size).toBe(declared);
    expect([...flagSpecsOf(registry).keys()].sort()).toEqual(['shop.banner', 'shop.checkout']);
  });
});
