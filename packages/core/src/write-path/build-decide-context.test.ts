import { describe, expect, test } from 'vitest';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { buildDecideContext } from './build-decide-context.ts';

const hostile = ['__proto__', 'constructor', 'prototype'] as const;

function registryOf(name: string, contextName: string): Registry {
  const entry = {
    module: 'library',
    name,
    ref: `library.${name}`,
    prefix: 'bk',
    origin: {},
    events: { [name]: {} },
  } as unknown as EntityEntry;
  return {
    entities: new Map([[entry.ref, entry]]),
    streams: new Map(),
    modules: [{ id: 'library', contextName }],
  } as unknown as Registry;
}

describe('buildDecideContext with names that are also prototype keys', () => {
  test.each(hostile)('%s as entity, module and event name alters no prototype', (key) => {
    const objectPrototype = Object.getPrototypeOf({}) as object;
    const before = Object.getOwnPropertyNames(objectPrototype).sort();
    const context = buildDecideContext({
      base: { secrets: {} },
      registry: registryOf(key, key),
      authorities: {} as never,
      module: 'library',
      prepared: undefined,
      newId: () => 'id',
      target: {
        entry: registryOf(key, key).entities.get(`library.${key}`) as EntityEntry,
        row: { id: 'r1' },
      },
    });
    const write = context.write as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.getPrototypeOf(write)).toBeNull();
    expect(Object.hasOwn(write, key)).toBe(true);
    expect(Object.hasOwn(write[key] ?? {}, key)).toBe(true);
    expect(Object.getPrototypeOf(context.events)).toBeNull();
    expect(Object.hasOwn(context.events as object, key)).toBe(true);
    expect(Object.getPrototypeOf({})).toBe(objectPrototype);
    expect(Object.getOwnPropertyNames(objectPrototype).sort()).toEqual(before);
    expect(({} as Record<string, unknown>).update).toBeUndefined();
  });
});
