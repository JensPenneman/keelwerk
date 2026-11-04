// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { SealedValue } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { storeHarness } from './support/store-harness.ts';
import { deploymentScope, id, stamp } from './support/store-rows.ts';
import { testScopes } from './support/test-scopes.ts';

const { deploymentId, scopeA, scopeB, tenantA } = testScopes;
const { run } = storeHarness('stores_keys');

describe('keys', () => {
  test('a destroyed value key opens to undefined; a shredded subject loses its data key', async () => {
    const plain = new TextEncoder().encode('secret');
    const sealedValue = await run<SealedValue>(scopeA, (u) =>
      u.keys.sealValue({ entity: 'e', id: id(1), field: 'f' }, plain),
    );
    expect(await run(scopeA, (u) => u.keys.openValue(sealedValue))).toEqual(plain);
    expect(await run(scopeB, (u) => u.keys.openValue(sealedValue))).toBeUndefined();
    await run(scopeA, (u) => u.keys.destroyValueKey(sealedValue.keyId));
    expect(await run(scopeA, (u) => u.keys.openValue(sealedValue))).toBeUndefined();
    const key = await run<{ id: string } | undefined>(scopeA, (u) =>
      u.keys.dataKey(id(5), { create: true }),
    );
    await run(scopeA, (u) => u.keys.shred(id(5)));
    expect(await run(scopeA, (u) => u.keys.keyById(key?.id ?? ''))).toBeUndefined();
    expect(await run(scopeA, (u) => u.keys.dataKey(id(5), { create: true }))).toBeUndefined();
  });

  test('two first uses of one subject create one key', async () => {
    const keys = await Promise.all([
      run<{ id: string } | undefined>(scopeA, (u) => u.keys.dataKey(id(8), { create: true })),
      run<{ id: string } | undefined>(scopeA, (u) => u.keys.dataKey(id(8), { create: true })),
    ]);
    expect(keys[0]?.id).toBeDefined();
    expect(keys[0]?.id).toBe(keys[1]?.id);
  });

  test('scope keys live in the control root and only a deployment unit has the store', async () => {
    const key = {
      scopeId: tenantA,
      level: 'tenant' as const,
      version: 1,
      wrapped: new Uint8Array([1, 2, 3]),
      createdAt: stamp,
      retiredAt: null,
    };
    await run(deploymentScope, async (u) => u.scopeKeys?.add(key));
    expect(await run(deploymentScope, async (u) => u.scopeKeys?.current(tenantA))).toEqual(key);
    expect(await run(scopeA, async (u) => u.scopeKeys)).toBeUndefined();
    await run(deploymentScope, async (u) => u.scopeKeys?.destroy(tenantA));
    expect(await run(deploymentScope, async (u) => u.scopeKeys?.current(tenantA))).toBeUndefined();
    expect(deploymentId).toBeDefined();
  });
});
