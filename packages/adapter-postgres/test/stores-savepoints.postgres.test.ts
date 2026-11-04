// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { describe, expect, test } from 'vitest';
import { setting, ticket } from './support/store-entities.ts';
import { storeHarness } from './support/store-harness.ts';
import { backendScope, row } from './support/store-rows.ts';
import { testScopes } from './support/test-scopes.ts';

const { backendId, scopeA, scopeB } = testScopes;
const { run, runSql } = storeHarness('stores_savepoints');

describe('savepoints and cross-scope reads', () => {
  test('a failed savepoint takes its rows back', async () => {
    const count = await run<number>(scopeA, async (u) => {
      await u.rows.insert(ticket, [row(1, { title: 'kept' })]);
      await u
        .nested(async (inner) => {
          await inner.rows.insert(ticket, [row(2, { title: 'undone' })]);
          throw new Error('undo');
        })
        .catch(() => undefined);
      return u.rows.count(ticket);
    });
    expect(count).toBe(1);
  });

  test('a tenant unit reads backend rows in a read-only savepoint; the database refuses a write there', async () => {
    await run(backendScope, (u) => u.rows.insert(setting, [row(1, { name: 'theme' })]));
    const seen = await runSql<unknown>(scopeA, async (u) => {
      const names = await u.nested(
        async (inner) => (await inner.rows.find(setting, {})).rows.map((found) => found.name),
        { as: backendScope, readOnly: true },
      );
      const bypass = await u
        .nested(
          async (inner) => {
            await inner.db
              .insertInto('app.kw_usage')
              .values({ scope_id: backendId, dimension: 'x', value: 1 })
              .execute();
          },
          { as: backendScope, readOnly: true },
        )
        .catch((error: { code?: string }) => error.code);
      await u.rows.insert(ticket, [row(1, { title: 'writable again' })]);
      return { names, bypass, mine: await u.rows.count(ticket) };
    });
    expect(seen).toEqual({ names: ['theme'], bypass: '25006', mine: 1 });
  });

  test('a unit spans one scope: a read-write savepoint in another scope, or a read of another tenant, is refused', async () => {
    const write = await run(scopeA, (u) =>
      u
        .nested((inner) => inner.rows.insert(setting, [row(1, { name: 'x' })]), {
          as: backendScope,
        })
        .catch((error: { kind?: string }) => error.kind),
    );
    const tenant = await run(scopeA, (u) =>
      u
        .nested(async () => undefined, { as: scopeB, readOnly: true })
        .catch((error: { kind?: string }) => error.kind),
    );
    expect({ write, tenant }).toEqual({ write: 'forbidden', tenant: 'forbidden' });
    expect(await run(backendScope, (u) => u.rows.count(setting))).toBe(0);
  });
});
