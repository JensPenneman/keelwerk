import type { StorageScope } from '@keelwerk/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PgliteAdapter, PgliteUnit } from '../src/pglite/index.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { tenantScope } from './support/tenant-scope.ts';

const tenantId = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';

const lockTimeout = async (unit: PgliteUnit): Promise<string | undefined> =>
  (await sql<{ value: string }>`select current_setting('lock_timeout') as value`.execute(unit.db))
    .rows[0]?.value;

describe('the lock timeout a unit already has', () => {
  let adapter: PgliteAdapter;
  beforeAll(async () => {
    adapter = await openClockedPglite();
    await adapter.schema.provision(exampleNamespace, []);
  }, 60_000);
  afterAll(async () => {
    await adapter?.close(1000);
  }, 60_000);
  const inUnit = <T>(scope: StorageScope, fn: (unit: PgliteUnit) => Promise<T>): Promise<T> =>
    adapter.unit(exampleNamespace, scope, fn);

  test('is put back after an advance', async () => {
    await inUnit(tenantScope, async (unit) => {
      await sql`select set_config('lock_timeout', '2s', true)`.execute(unit.db);
      await unit.consumers.advance('test.lock-timeout', tenantId, 0n);
      expect(await lockTimeout(unit)).toBe('2s');
    });
  });

  test('is put back after the start of a consumer', async () => {
    await inUnit(namespaceScope, async (unit) => {
      await sql`select set_config('lock_timeout', '2s', true)`.execute(unit.db);
      expect(await unit.consumers.startAtHeads('test.lock-timeout-start')).toBe(true);
      expect(await lockTimeout(unit)).toBe('2s');
    });
  });
});
