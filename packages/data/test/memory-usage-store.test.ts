import { expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { openMemory } from './support/memory-fixture.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const charge = (dimension: string, delta: bigint) => ({ dimension, delta, limit: null });

test('a charge and a give-back apply at the commit and get reads the counter; an unused dimension is 0', async () => {
  const memory = openMemory();
  const before = await memory.read(tenantScope, (unit) => unit.usage.get('rows'));
  await memory.run(tenantScope, async (unit) => {
    unit.usage.charge([charge('rows', 5n)]);
    unit.usage.giveBack('rows', 2n);
    // The counter is read as committed: the tail has not applied this unit's changes yet.
    expect(await unit.usage.get('rows')).toBe(0n);
  });
  expect([before, await memory.read(tenantScope, (unit) => unit.usage.get('rows'))]).toEqual([
    0n,
    3n,
  ]);
});

test('counters commit with the unit and are per scope', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, async (unit) => unit.usage.charge([charge('bytes', 10n)]));
  await memory
    .run(tenantScope, async (unit) => {
      unit.usage.charge([charge('bytes', 100n)]);
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(await memory.read(tenantScope, (unit) => unit.usage.get('bytes'))).toBe(10n);
  expect(await memory.read(tenantTwo, (unit) => unit.usage.get('bytes'))).toBe(0n);
  expect(await memory.read(backendScope, (unit) => unit.usage.get('bytes'))).toBe(0n);
});

test('a savepoint that fails takes its charges and give-backs back', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, async (unit) => {
    unit.usage.charge([charge('n', 1n)]);
    await unit
      .nested(async (inner) => {
        inner.usage.charge([charge('n', 5n)]);
        inner.usage.giveBack('n', 3n);
        throw new Error('undo');
      })
      .catch(() => undefined);
  });
  expect(await memory.read(tenantScope, (unit) => unit.usage.get('n'))).toBe(1n);
});
