import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  type PgliteAdapter,
  PgliteReentrantUnitError,
  pgliteAdapter,
  pgliteCapabilities,
} from '../src/pglite/index.ts';
import { deployment as deploymentId } from './support/deployment.ts';
import { insertSerial } from './support/insert-serial.ts';
import { namespaceRef } from './support/namespace-ref.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { serialNames } from './support/serial-names.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';

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

describe('units', () => {
  test('commit keeps the writes and rollback discards them', async () => {
    const adapter = shared;
    await adapter.unit(namespaceRef, scope, async (u) =>
      runStatement(u, insertSerial, [tenantA, 'kept']),
    );
    await expect(
      adapter.unit(namespaceRef, scope, async (u) => {
        await runStatement(u, insertSerial, [tenantA, 'lost']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await serialNames(adapter, scope)).toEqual(['kept']);
  });

  test('a read-only unit refuses writes', async () => {
    const adapter = shared;
    await expect(
      adapter.unit(
        namespaceRef,
        scope,
        async (u) => runStatement(u, insertSerial, [tenantA, 'no']),
        { readOnly: true },
      ),
    ).rejects.toMatchObject({ code: '25006' });
  });

  test('units are serialised and the session settings end with the transaction', async () => {
    const adapter = shared;
    const order: string[] = [];
    const slow = adapter.unit(namespaceRef, scope, async (u) => {
      order.push('first start');
      await runStatement(u, 'select pg_sleep(0.05)');
      order.push('first end');
    });
    const quick = adapter.unit(namespaceRef, scope, async () => {
      order.push('second');
    });
    await Promise.all([slow, quick]);
    expect(order).toEqual(['first start', 'first end', 'second']);
    const after = await adapter.asOwner(async (database) =>
      database.query<{ who: string; setting: string }>(
        `select current_user as who, current_setting('keelwerk.tenant_id', true) as setting`,
      ),
    );
    expect(after.rows[0]).toEqual({ who: 'postgres', setting: '' });
  });

  test('the unit sets its local statement timeout, which ends with the transaction', async () => {
    const adapter = shared;
    const inside = await adapter.unit(
      namespaceRef,
      scope,
      async (u) =>
        (await runStatement(u, `select current_setting('statement_timeout') as value`)).rows[0],
      { timeoutMs: 50 },
    );
    expect(inside).toEqual({ value: '50ms' });
    const outside = await adapter.asOwner(async (database) =>
      database.query<{ value: string }>(`select current_setting('statement_timeout') as value`),
    );
    expect(outside.rows[0]?.value).toBe('0');
  });

  test('an aborted signal stops a unit before it begins', async () => {
    const adapter = shared;
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(
      adapter.unit(namespaceRef, scope, async () => 1, { signal: controller.signal }),
    ).rejects.toThrow('stopped');
    expect(await serialNames(adapter, scope)).toEqual([]);
  });
});

describe('savepoints', () => {
  test('a failed nested unit rolls back to its savepoint and the outer unit goes on', async () => {
    const adapter = shared;
    await adapter.unit(namespaceRef, scope, async (u) => {
      await runStatement(u, insertSerial, [tenantA, 'outer']);
      await expect(
        u.nested(async (inner) => {
          await runStatement(inner, insertSerial, [tenantA, 'inner']);
          await inner.nested(async (deeper) => {
            await runStatement(deeper, insertSerial, [tenantA, 'deeper']);
          });
          throw new Error('inner failed');
        }),
      ).rejects.toThrow('inner failed');
      await u.nested(async (second) => runStatement(second, insertSerial, [tenantA, 'second']));
    });
    expect(await serialNames(adapter, scope)).toEqual(['outer', 'second']);
  });

  test('a statement error inside a nested unit leaves the unit usable', async () => {
    const adapter = shared;
    await adapter.unit(namespaceRef, scope, async (u) => {
      await expect(
        u.nested(async (inner) => runStatement(inner, 'select 1/0')),
      ).rejects.toMatchObject({
        code: '22012',
      });
      await runStatement(u, insertSerial, [tenantA, 'after']);
    });
    expect(await serialNames(adapter, scope)).toEqual(['after']);
  });

  test('after-commit work registered in a rolled-back savepoint is dropped', async () => {
    const adapter = shared;
    const ran: string[] = [];
    await adapter.unit(namespaceRef, scope, async (u) => {
      u.afterCommit(() => ran.push('outer'));
      await u
        .nested(async (inner) => inner.afterCommit(() => ran.push('kept')))
        .catch(() => undefined);
      await u
        .nested(async (inner) => {
          inner.afterCommit(() => ran.push('dropped'));
          throw new Error('x');
        })
        .catch(() => undefined);
    });
    expect(ran).toEqual(['outer', 'kept']);
  });
});

describe('the unit owns its transaction', () => {
  test('a Kysely transaction in a unit is rejected and the unit still runs as the application role', async () => {
    await shared.asOwner(async (database) => {
      await database.query(`insert into ${ns}.kw_serials values ($1, 'a.b', 'other', '[]', 1)`, [
        tenantB,
      ]);
    });
    const outcome = await shared.unit(namespaceRef, scope, async (u) => {
      const refused = await u.db
        .transaction()
        .execute(async () => 1)
        .then(
          () => 'allowed',
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
      const after = await runStatement(
        u,
        `select current_user as who, (select count(*) from ${ns}.kw_serials)::int as n`,
      );
      return { refused, row: after.rows[0] };
    });
    expect(outcome.refused).toMatch(/unit owns the transaction/);
    expect(outcome.row).toEqual({ who: 'kw_app', n: 0 });
  });

  test('a unit requested from inside a unit is refused instead of waiting forever', async () => {
    await expect(
      shared.unit(namespaceRef, scope, async () => shared.unit(namespaceRef, scope, async () => 1)),
    ).rejects.toBeInstanceOf(PgliteReentrantUnitError);
    await expect(
      shared.asOwner(async () => shared.unit(namespaceRef, scope, async () => 1)),
    ).rejects.toBeInstanceOf(PgliteReentrantUnitError);
    expect(await serialNames(shared, scope)).toEqual([]);
  });
});

describe('the adapter and its application role', () => {
  test('reports PostgreSQL capabilities with row-level security', async () => {
    const adapter = shared;
    expect(await adapter.health()).toEqual({ ok: true });
    expect(pgliteCapabilities()).toMatchObject({
      dialect: 'postgres',
      jobs: 'single-writer',
      rowLevelSecurity: true,
      changeFeed: 'notify',
      placements: ['shared-tables'],
    });
    expect(adapter.feed.level).toBe('notify');
  });

  test('a role name that is not a plain role name is refused when the adapter is created', () => {
    expect(() => pgliteAdapter({ deploymentId }, { role: 'pg_monitor' })).toThrow(TypeError);
    expect(() => pgliteAdapter({ deploymentId }, { role: 'a"b' })).toThrow(TypeError);
  });

  test('connect refuses a role that is a superuser', async () => {
    const adapter = pgliteAdapter({ deploymentId }, { role: 'postgres' });
    await expect(adapter.connect()).rejects.toThrow(/bypass row-level security/);
    await adapter.close(1000);
  }, 60_000);
});
