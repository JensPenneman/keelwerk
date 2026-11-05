import { describe, expect, test } from 'vitest';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { ServiceEntry } from '../registry/service-entry.ts';
import { bindServices } from './bind-services.ts';
import { buildLoadConstructors } from './build-load-constructors.ts';

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

const profile = { ref: 'accounts.profile', module: 'accounts', name: 'profile' } as EntityEntry;
const lookup: ServiceEntry = {
  ref: 'accounts.lookup',
  module: 'accounts',
  name: 'lookup',
  fn: () => 'found',
};

const auth = moduleOf('auth', { optional: ['accounts'] });
const accounts = moduleOf('accounts', {
  entities: ['accounts.profile'],
  services: ['accounts.lookup'],
});

const registryOf = (modules: readonly ModuleEntry[]): Registry =>
  ({
    modules,
    contributions: [],
    entities: new Map([[profile.ref, profile]]),
    services: new Map([[lookup.ref, lookup]]),
  }) as unknown as Registry;

const ifPresentOnly = ['ifPresent'];

describe('an optional module under within()', () => {
  test('loads: present, the direct members sit beside ifPresent', () => {
    const loads = buildLoadConstructors(registryOf([auth, accounts]), auth, new WeakMap());
    expect(Object.keys(loads.accounts as object).toSorted()).toEqual(['ifPresent', 'profile']);
  });

  test('loads: absent, only ifPresent', () => {
    const loads = buildLoadConstructors(registryOf([auth]), auth, new WeakMap());
    expect(Object.keys(loads.accounts as object)).toEqual(ifPresentOnly);
  });

  test('services: present, the direct members sit beside ifPresent and are callable', () => {
    const services = bindServices(
      registryOf([auth, accounts]),
      auth,
      (id) => ({ id }),
      new WeakMap(),
    );
    const members = services.accounts as { lookup(): string };
    expect(Object.keys(members).toSorted()).toEqual(['ifPresent', 'lookup']);
    expect(members.lookup()).toBe('found');
  });

  test('services: absent, only ifPresent', () => {
    const services = bindServices(registryOf([auth]), auth, (id) => ({ id }), new WeakMap());
    expect(Object.keys(services.accounts as object)).toEqual(ifPresentOnly);
  });
});
