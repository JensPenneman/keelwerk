import type { Unit } from '@keelwerk/core';
import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { hooksApp } from './hooks-kit.ts';

/**
 * The two-tenant case of `core.effect` through the runtime (reviewer check 7): each of two tenants
 * requests an effect; a unit of one tenant finds none of the other's rows and cannot update one. The
 * maintenance policy is proved at the SQL level in the data package. No worker starts, so the
 * effects stay requested.
 */
export async function effectTenancyCase(
  options: Pick<TestRuntimeOptions, 'adapter' | 'external'>,
): Promise<void> {
  const runtime = await startTestRuntime(hooksApp, {
    ...options,
    config: { hooks: { endpoint: 'http://127.0.0.1:1/', signingKey: 'hook-signing-key' } },
  });
  try {
    for (const tenant of ['acme', 'globex'] as const) {
      const client = createLocalClient(runtime, { principal: testPrincipal('ada'), tenant });
      await client.invoke('hooks.notify', { payload: `for ${tenant}` });
    }
    const entry = runtime.app.registry.entities.get('core.effect');
    if (entry === undefined) throw new Error('the app has no core.effect');
    const descriptor = entry.descriptor;
    const asTenant = <T>(name: 'acme' | 'globex', fn: (unit: Unit) => Promise<T>): Promise<T> =>
      runtime.adapter.unit(
        runtime.namespace,
        { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants[name].id },
        fn,
      );
    const mine = {
      acme: await asTenant('acme', async (unit) => (await unit.rows.find(descriptor, {})).rows),
      globex: await asTenant('globex', async (unit) => (await unit.rows.find(descriptor, {})).rows),
    };
    expect(mine.acme).toHaveLength(1);
    expect(mine.globex).toHaveLength(1);
    const [acmeRow] = mine.acme;
    const [globexRow] = mine.globex;
    if (acmeRow === undefined || globexRow === undefined) throw new Error('an effect is missing');
    expect(acmeRow.id).not.toBe(globexRow.id);
    // A unit of globex finds none of acme's rows, by id or by type, and cannot update one.
    await asTenant('globex', async (unit) => {
      expect(
        await unit.rows.findOne(descriptor, {
          where: { op: 'eq', field: 'id', value: acmeRow.id },
        }),
      ).toBeUndefined();
      expect(await unit.rows.exists(descriptor, [String(acmeRow.id)])).toEqual(new Set());
    });
    await expect(
      asTenant('globex', (unit) =>
        unit.rows.update(descriptor, [
          {
            id: String(acmeRow.id),
            expectedVersion: Number(acmeRow.version),
            values: { ...acmeRow, status: 'failed' },
          },
        ]),
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
    // Nothing changed: acme's row is as it was, and globex's own row is still updatable only by globex.
    const after = await asTenant('acme', (unit) => unit.rows.find(descriptor, {}));
    expect(after.rows[0]).toMatchObject({ id: acmeRow.id, status: 'requested' });
  } finally {
    await runtime.stop();
  }
}
