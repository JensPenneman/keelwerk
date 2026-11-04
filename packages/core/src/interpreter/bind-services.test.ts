import { describe, expect, test } from 'vitest';
import type { ExtensionFillEntry } from '../registry/extension-fill-entry.ts';
import type { ExtensionPointEntry } from '../registry/extension-point-entry.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { ServiceEntry } from '../registry/service-entry.ts';
import { bindExtensionValues } from './bind-extension-values.ts';
import { bindServices } from './bind-services.ts';

const moduleOf = (id: string, over: Partial<ModuleEntry> = {}): ModuleEntry =>
  ({
    id,
    contextName: id,
    requires: [],
    optional: [],
    entities: [],
    services: [],
    extensionPoints: [],
    flags: {},
    ...over,
  }) as unknown as ModuleEntry;

const hash: ServiceEntry = {
  ref: 'auth.hash',
  module: 'auth',
  name: 'hash',
  fn: (own: unknown, value: unknown) => `${(own as { id: string }).id}:${String(value)}`,
};

const point = (mode: ExtensionPointEntry['mode']): ExtensionPointEntry => ({
  ref: 'accounts.providers',
  module: 'accounts',
  name: 'providers',
  mode,
  hasDefault: false,
});
const fill = (over: Partial<ExtensionFillEntry>): ExtensionFillEntry => ({
  point: 'accounts.providers',
  module: 'auth',
  bound: false,
  fill: 'x',
  ...over,
});

function registryOf(
  modules: readonly ModuleEntry[],
  mode: ExtensionPointEntry['mode'],
  fills: readonly ExtensionFillEntry[],
): Registry {
  return {
    modules,
    services: new Map([[hash.ref, hash]]),
    extensionPoints: new Map([['accounts.providers', point(mode)]]),
    fills: new Map([['accounts.providers', fills]]),
  } as unknown as Registry;
}

describe('bindServices', () => {
  const auth = moduleOf('auth', { services: ['auth.hash'] });
  const accounts = moduleOf('accounts', { requires: ['auth'], optional: ['mail-store'] });
  const registry = registryOf([auth, accounts], 'set', []);

  test('a service is called with its provider context and the caller arguments', () => {
    const services = bindServices(registry, accounts, (id) => ({ id }), new WeakMap());
    expect((services.auth as { hash(v: string): string }).hash('pw')).toBe('auth:pw');
  });

  test('an optional module that is absent is a Maybe accessor, named in lower camel case', () => {
    const services = bindServices(registry, accounts, (id) => ({ id }), new WeakMap());
    const maybe = services.mailStore as { ifPresent(f: () => never): { present: boolean } };
    expect(maybe.ifPresent(() => never())).toMatchObject({ present: false });
  });
});

function never(): never {
  throw new Error('not called');
}

describe('bindExtensionValues', () => {
  const accounts = moduleOf('accounts', { extensionPoints: ['accounts.providers'] });
  const read = (mode: ExtensionPointEntry['mode'], fills: readonly ExtensionFillEntry[]) =>
    bindExtensionValues(registryOf([accounts], mode, fills), accounts, (id) => ({ id })).providers;

  test('a set point lists the fills in order and flattens a fill that holds a list', () => {
    expect(read('set', [fill({ fill: 'a' }), fill({ fill: ['b', 'c'] })])).toEqual(['a', 'b', 'c']);
  });

  test('a bound fill is a factory instantiated with its contributor context', () => {
    const factory = (own: unknown) => `from:${(own as { id: string }).id}`;
    expect(read('ordered', [fill({ bound: true, fill: factory })])).toEqual(['from:auth']);
  });

  test('a single point reads as one value, and as undefined without a fill', () => {
    expect(read('single', [fill({ fill: 'only' })])).toBe('only');
    expect(read('single', [])).toBeUndefined();
  });
});
