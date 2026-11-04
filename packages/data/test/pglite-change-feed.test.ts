import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { collectWakes } from './support/collect-wakes.ts';
import { deployment } from './support/deployment.ts';
import { insertSerial } from './support/insert-serial.ts';
import { namespaceRef } from './support/namespace-ref.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

const scope = storageTenant(tenantA);

let shared: PgliteAdapter;
beforeAll(async () => {
  shared = await provisionedPglite();
}, 60_000);
afterAll(async () => {
  await shared?.close(1000);
}, 60_000);
beforeEach(async () => {
  await shared.asOwner(async (database) => {
    await database.query(`truncate ${ns}.kw_serials`);
  });
});

describe('the change feed', () => {
  test('a committed unit wakes its namespace and scope once', async () => {
    const adapter = shared;
    const seen = await collectWakes(adapter, async () => {
      await adapter.unit(namespaceRef, scope, async (u) =>
        runStatement(u, insertSerial, [tenantA, 'a']),
      );
      await adapter.unit(namespaceRef, scope, async (u) =>
        runStatement(u, insertSerial, [tenantA, 'b']),
      );
    });
    const scopeIds = new Set(seen.flatMap((wake) => wake.scopeIds));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((wake) => wake.namespace === namespaceRef.id)).toBe(true);
    expect([...scopeIds]).toEqual([tenantA]);
  });

  test('a deployment unit wakes with the deployment id, never a made-up one', async () => {
    const adapter = shared;
    const seen = await collectWakes(adapter, async () =>
      adapter.unit(namespaceRef, { level: 'deployment' }, async () => 1),
    );
    expect(seen.flatMap((wake) => wake.scopeIds)).toEqual([deployment]);
  });

  test('a rolled-back unit sends no wake-up', async () => {
    const adapter = shared;
    const seen = await collectWakes(adapter, async () => {
      await adapter
        .unit(namespaceRef, scope, async (u) => {
          await runStatement(u, insertSerial, [tenantA, 'x']);
          throw new Error('boom');
        })
        .catch(() => undefined);
    });
    expect(seen).toEqual([]);
  });

  test('a read-only unit sends no wake-up', async () => {
    const adapter = shared;
    const seen = await collectWakes(adapter, async () =>
      adapter.unit(namespaceRef, scope, async () => 1, { readOnly: true }),
    );
    expect(seen).toEqual([]);
  });

  test('another namespace is not woken', async () => {
    const adapter = shared;
    const seen = await collectWakes(adapter, async () =>
      adapter.unit({ ...namespaceRef, id: 'other' }, scope, async () => 1),
    );
    expect(seen).toEqual([]);
  });
});
