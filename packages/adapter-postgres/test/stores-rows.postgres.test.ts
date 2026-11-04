// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { setting, ticket } from './support/store-entities.ts';
import { storeHarness } from './support/store-harness.ts';
import { backendScope, id, row, stamp } from './support/store-rows.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB, tenantA } = testScopes;
const { run, runSql, failure, adapter } = storeHarness('stores_rows');

describe('rows', () => {
  test('insert, find, a versioned update and the version conflict', async () => {
    await run(scopeA, (u) =>
      u.rows.insert(ticket, [row(1, { title: 'one' }), row(2, { title: 'two' })]),
    );
    await run(scopeA, (u) =>
      u.rows.update(ticket, [
        { id: id(1), expectedVersion: 1, values: row(1, { version: 2, title: 'uno' }) },
      ]),
    );
    const titles = await run<unknown[]>(scopeA, async (u) =>
      (await u.rows.find(ticket, { sort: [{ field: 'title', direction: 'asc' }] })).rows.map(
        (found) => found.title,
      ),
    );
    expect(titles).toEqual(['two', 'uno']);
    const stale = await failure(
      run(scopeA, (u) =>
        u.rows.update(ticket, [
          { id: id(1), expectedVersion: 1, values: row(1, { version: 2, title: 'late' }) },
        ]),
      ),
    );
    expect(stale).toEqual({ kind: 'conflict', code: 'core.version_mismatch' });
  });

  test('a unique violation is conflict core.conflict; counts leave archived rows out', async () => {
    await run(scopeA, (u) => u.rows.insert(ticket, [row(1, { title: 'one' })]));
    const clash = await failure(
      run(scopeA, (u) => u.rows.insert(ticket, [row(2, { title: 'one' })])),
    );
    expect(clash).toEqual({ kind: 'conflict', code: 'core.conflict' });
    await run(scopeA, (u) =>
      u.rows.insert(ticket, [
        row(3, { title: 'gone', archivedAt: stamp }),
        row(4, { title: 'live' }),
      ]),
    );
    const [count, exists] = await run<[number, ReadonlySet<string>]>(scopeA, async (u) => [
      await u.rows.count(ticket),
      await u.rows.exists(ticket, [id(1), id(3), id(9)]),
    ]);
    expect([count, [...exists]]).toEqual([2, [id(1)]]);
  });

  test('every store refuses another scope: rows, serials, usage, buckets, keys', async () => {
    await run(scopeA, async (u) => {
      await u.rows.insert(ticket, [row(1, { title: 'mine' })]);
      await u.usage.add('rows', 4n);
      await u.serials.next(ticket, 'number', ['box']);
      await u.buckets.take('k', 2, { capacity: 2, refillPerSecond: 0.5 });
      await u.keys.dataKey(id(70), { create: true });
    });
    const other = await run<unknown[]>(scopeB, async (u) => [
      await u.rows.count(ticket),
      await u.usage.get('rows'),
      await u.keys.dataKey(id(70), { create: false }),
      await u.rows.purge(ticket, [id(1)]),
      await u.serials.next(ticket, 'number', ['box']),
      await u.buckets.take('k', 2, { capacity: 2, refillPerSecond: 0.5 }),
    ]);
    expect(other).toEqual([0, 0n, undefined, 0, 1n, { ok: true }]);
    expect(await failure(run(scopeA, (u) => u.rows.find(setting, {})))).toEqual({
      kind: 'forbidden',
      code: 'core.forbidden',
    });
    expect(await failure(run(backendScope, (u) => u.rows.find(ticket, {})))).toEqual({
      kind: 'forbidden',
      code: 'core.forbidden',
    });
  });

  test('forced row-level security confines a statement that skips the scoping plugin', async () => {
    await run(scopeA, (u) => u.rows.insert(ticket, [row(1, { title: 'a' })]));
    await run(scopeB, (u) => u.rows.insert(ticket, [row(2, { title: 'b' })]));
    const raw = await runSql<unknown[]>(scopeA, async (u) =>
      (await u.db.selectFrom('app.app__ticket').select('title').execute()).map(
        (found) => found.title,
      ),
    );
    expect(raw).toEqual(['a']);
  });

  test('a positioned read carries next - 1 of the scope counter', async () => {
    await runSql(scopeA, async (u) => {
      await u.db
        .insertInto('app.kw_positions')
        .values({ scope_id: tenantA, next: 6, epoch: 1 })
        .execute();
      await u.rows.insert(ticket, [row(1, { title: 'a' })]);
    });
    const page = await run<{ position?: bigint; rows: readonly StorageRow[] }>(scopeA, (u) =>
      u.rows.find(ticket, { positioned: true }),
    );
    expect([page.position, page.rows.length]).toEqual([5n, 1]);
    const empty = await run<{ position?: bigint }>(scopeB, (u) =>
      u.rows.find(ticket, { positioned: true }),
    );
    expect(empty.position).toBe(0n);
  });

  test('skip locked and no wait see the row another unit holds', async () => {
    await run(scopeA, (u) => u.rows.insert(ticket, [row(1, { title: 'a' })]));
    const outcome = await run<unknown[]>(scopeA, async (holder) => {
      const held = await holder.rows.lock?.(ticket, {}, { mode: 'update' });
      return adapter().unit(testNamespace, scopeA, async (other) => [
        held?.length,
        (await other.rows.lock?.(ticket, {}, { mode: 'update', skipLocked: true }))?.length,
        await other
          .nested(async (inner) => inner.rows.lock?.(ticket, {}, { mode: 'update', noWait: true }))
          .catch((error: { code?: string }) => error.code),
      ]);
    });
    expect(outcome).toEqual([1, 0, '55P03']);
  });
});
