import type { AdapterEnvironment } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { memoryAdapter } from '../src/memory/memory-adapter.ts';
import { failure } from './support/failure.ts';
import { openMemory } from './support/memory-fixture.ts';

test('the factory is the adapter `memory` of dialect memory', () => {
  const factory = memoryAdapter();
  expect([factory.id, factory.dialect]).toEqual(['memory', 'memory']);
  expect(factory.options['~standard'].version).toBe(1);
});

test('connect declares the in-memory capabilities (14.3.7, S-37)', async () => {
  const capabilities = await openMemory().adapter.connect();
  expect(capabilities).toMatchObject({
    dialect: 'memory',
    eventStore: true,
    transactions: { savepoints: true, transactionalDdl: true },
    placements: ['shared-tables'],
    rowLocks: false,
    search: 'naive',
    jobs: 'single-writer',
    processes: 'single',
    changeFeed: 'notify',
    sql: false,
    broadcast: false,
    unsupportedConditions: [],
    encryptedQueries: { equality: true, tagSets: false, order: false },
  });
  expect(capabilities.encryptedQueries.maxScan).toBeGreaterThan(0);
  expect(capabilities.positionPaging).toEqual({ maxOffset: 10_000 });
});

test('only shared tables are hosted, the placement id is kept, identity is stable per instance', async () => {
  const environment = {} as AdapterEnvironment;
  const factory = memoryAdapter();
  expect(
    (
      await failure(
        Promise.resolve().then(() =>
          factory.create({ id: 'p', strategy: 'schema-per-tenant' }, environment),
        ),
      )
    ).kind,
  ).toBe('unsupported');
  const one = factory.create({ id: 'p', strategy: 'shared-tables' }, environment);
  const two = factory.create({ id: 'q', strategy: 'shared-tables' }, environment);
  expect(one.placementId).toBe('p');
  expect(await one.identity()).toEqual(await one.identity());
  expect((await one.identity()).systemId).not.toBe((await two.identity()).systemId);
  expect(await one.health()).toEqual({ ok: true });
  expect(one.broadcast).toBeUndefined();
});

test('a store keeps nothing of one instance in another', async () => {
  const a = openMemory();
  const b = openMemory();
  await a.run({ level: 'deployment' }, (unit) => unit.usage.add('x', 1n));
  expect(await b.read({ level: 'deployment' }, (unit) => unit.usage.get('x'))).toBe(0n);
});
