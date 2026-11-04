import { expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { openMemory } from './support/memory-fixture.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

test('add returns the new value and get reads it; an unused dimension is 0', async () => {
  const memory = openMemory();
  const values = await memory.run(tenantScope, async (unit) => [
    await unit.usage.get('rows'),
    await unit.usage.add('rows', 5n),
    await unit.usage.add('rows', -2n),
    await unit.usage.get('rows'),
  ]);
  expect(values).toEqual([0n, 5n, 3n, 3n]);
});

test('counters commit with the unit and are per scope', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, (unit) => unit.usage.add('bytes', 10n));
  await memory
    .run(tenantScope, async (unit) => {
      await unit.usage.add('bytes', 100n);
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(await memory.read(tenantScope, (unit) => unit.usage.get('bytes'))).toBe(10n);
  expect(await memory.read(tenantTwo, (unit) => unit.usage.get('bytes'))).toBe(0n);
  expect(await memory.read(backendScope, (unit) => unit.usage.get('bytes'))).toBe(0n);
});

test('a savepoint that fails takes its additions back', async () => {
  const memory = openMemory();
  const value = await memory.run(tenantScope, async (unit) => {
    await unit.usage.add('n', 1n);
    await unit
      .nested(async (inner) => {
        await inner.usage.add('n', 5n);
        throw new Error('undo');
      })
      .catch(() => undefined);
    return unit.usage.get('n');
  });
  expect(value).toBe(1n);
});
