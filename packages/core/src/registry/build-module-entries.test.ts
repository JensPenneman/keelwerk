import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { FlagSpec } from '../flags/flag-spec.ts';
import { buildRegistry } from './build-registry.ts';
import type { ModuleEntry } from './module-entry.ts';

const flags = {
  checkout: defineFlag({
    kind: 'boolean',
    default: false,
    level: 'tenant',
    purpose: 'release',
    expires: '2027-06-30',
    client: true,
  }),
  banner: defineFlag({
    kind: 'string',
    default: 'hello',
    level: 'backend',
    purpose: 'operational',
    client: false,
  }),
  pageSize: defineFlag({
    kind: 'number',
    default: 25,
    level: 'deployment',
    purpose: 'operational',
    min: 1,
    max: 100,
  }),
  layout: defineFlag({
    kind: 'json',
    schema: shape({ columns: field.integer() }),
    default: { columns: 2 },
    level: 'principal',
    purpose: 'experiment',
    expires: '2027-01-31',
  }),
  theme: defineFlag({
    kind: 'variant',
    variants: ['light', 'dark'],
    default: 'light',
    level: 'principal',
    purpose: 'permission',
  }),
};

function entryOf(name: keyof typeof flags): ModuleEntry['flags'][string] | undefined {
  const registry = buildRegistry(appOf([makeModule({ id: 'm', flags })]));
  return registry.modules.find((module) => module.id === 'm')?.flags[name];
}

describe('the flag entries of the registry', () => {
  test('copies purpose, expires and client of every flag kind into the registry entry', () => {
    expect(entryOf('checkout')).toMatchObject({
      kind: 'boolean',
      purpose: 'release',
      expires: '2027-06-30',
      client: true,
    });
    expect(entryOf('banner')).toMatchObject({
      kind: 'string',
      purpose: 'operational',
      client: false,
    });
    expect(entryOf('pageSize')).toMatchObject({ kind: 'number', purpose: 'operational' });
    expect(entryOf('layout')).toMatchObject({
      kind: 'json',
      purpose: 'experiment',
      expires: '2027-01-31',
    });
    expect(entryOf('theme')).toMatchObject({
      kind: 'variant',
      purpose: 'permission',
      variants: ['light', 'dark'],
    });
  });

  test('leaves expires and client out when the literal has none', () => {
    const entry = entryOf('theme');
    expect(entry).toBeDefined();
    expect('expires' in (entry as object)).toBe(false);
    expect('client' in (entry as object)).toBe(false);
  });

  test('a registry entry with its key is a FlagSpec', () => {
    const entry = entryOf('checkout');
    if (entry === undefined) {
      throw new Error('The checkout flag has no registry entry.');
    }
    const spec: FlagSpec = { ...entry, key: 'm.checkout' };
    expect(spec.key).toBe('m.checkout');
    expect(spec.kind).toBe('boolean');
    expect(spec.level).toBe(flags.checkout.level);
    expect(spec.default).toBe(flags.checkout.default);
    expect(spec.purpose).toBe(flags.checkout.purpose);
  });
});
