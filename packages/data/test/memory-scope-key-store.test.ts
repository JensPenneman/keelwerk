import type { WrappedScopeKey } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { failure } from './support/failure.ts';
import { openMemory } from './support/memory-fixture.ts';
import { stamp } from './support/stamp.ts';
import { tenantScope } from './support/tenant-scope.ts';

const tenant = '00000000-0000-4000-8000-0000000000a1';

function key(version: number, over: Partial<WrappedScopeKey> = {}): WrappedScopeKey {
  return {
    scopeId: tenant,
    level: 'tenant',
    version,
    wrapped: new Uint8Array([version, 2, 3]),
    createdAt: stamp,
    retiredAt: null,
    ...over,
  };
}

test('only deployment-scope units have the store', async () => {
  const memory = openMemory();
  expect(await memory.run(deploymentScope, async (unit) => unit.scopeKeys !== undefined)).toBe(
    true,
  );
  expect(await memory.run(tenantScope, async (unit) => unit.scopeKeys)).toBeUndefined();
  expect(await memory.run(backendScope, async (unit) => unit.scopeKeys)).toBeUndefined();
});

test('add stores a version, current is the latest not retired one, byVersion finds any', async () => {
  const memory = openMemory();
  await memory.run(deploymentScope, async (unit) => {
    await unit.scopeKeys?.add(key(1));
    await unit.scopeKeys?.add(key(2));
  });
  const read = await memory.read(deploymentScope, async (unit) => ({
    current: await unit.scopeKeys?.current(tenant),
    first: await unit.scopeKeys?.byVersion(tenant, 1),
    none: await unit.scopeKeys?.current('other'),
  }));
  expect(read.current).toEqual(key(2));
  expect(read.first).toEqual(key(1));
  expect(read.none).toBeUndefined();
});

test('a repeated version is a conflict; retire moves current back; destroy removes every version', async () => {
  const memory = openMemory();
  await memory.run(deploymentScope, async (unit) => {
    await unit.scopeKeys?.add(key(1));
    await unit.scopeKeys?.add(key(2));
  });
  expect(
    (await failure(memory.run(deploymentScope, async (unit) => unit.scopeKeys?.add(key(2))))).kind,
  ).toBe('conflict');
  const later = stamp.add({ hours: 1 });
  await memory.run(deploymentScope, async (unit) => unit.scopeKeys?.retire(tenant, 2, later));
  const after = await memory.read(deploymentScope, async (unit) => ({
    current: (await unit.scopeKeys?.current(tenant))?.version,
    retired: (await unit.scopeKeys?.byVersion(tenant, 2))?.retiredAt,
  }));
  expect(after.current).toBe(1);
  expect(after.retired?.equals(later)).toBe(true);
  expect(
    (
      await failure(
        memory.run(deploymentScope, async (unit) => unit.scopeKeys?.retire(tenant, 9, later)),
      )
    ).kind,
  ).toBe('not_found');
  await memory.run(deploymentScope, async (unit) => unit.scopeKeys?.destroy(tenant));
  expect(
    await memory.read(deploymentScope, async (unit) => unit.scopeKeys?.current(tenant)),
  ).toBeUndefined();
  expect(
    await memory.read(deploymentScope, async (unit) => unit.scopeKeys?.byVersion(tenant, 1)),
  ).toBeUndefined();
});

test('the key bytes stored are a copy', async () => {
  const memory = openMemory();
  const original = key(1);
  await memory.run(deploymentScope, async (unit) => unit.scopeKeys?.add(original));
  original.wrapped.fill(0);
  const stored = await memory.read(deploymentScope, async (unit) =>
    unit.scopeKeys?.current(tenant),
  );
  expect(stored?.wrapped).toEqual(new Uint8Array([1, 2, 3]));
});
