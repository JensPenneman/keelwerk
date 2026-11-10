import { readFileSync } from 'node:fs';
import type { DataAdapterFactory } from '@keelwerk/core';
import type { PgliteAdapter } from '@keelwerk/data/pglite';
import { afterAll, expect, test } from 'vitest';
import { pgliteFactory } from '../src/harness/pglite-factory.ts';
import { slice2 } from './support/slice-2.ts';

const dump = readFileSync(new URL('../../data/test/fixtures/m1-dump.sql', import.meta.url), 'utf8');

/** The PGlite factory whose control database holds the M1 dump from its first connect on. */
function factoryOverM1Dump(): DataAdapterFactory {
  const inner = pgliteFactory();
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      if (placement.id !== 'control') return adapter;
      return {
        ...adapter,
        connect: async () => {
          const capabilities = await adapter.connect();
          await (adapter as unknown as PgliteAdapter).asOwner(async (database) =>
            database.exec(dump),
          );
          return capabilities;
        },
      };
    },
  };
}

const kit = slice2({ factory: factoryOverM1Dump(), volatile: true });
afterAll(() => kit.adapters.closeAll());

test('a control store created under M1 migrates to the M2 tables when the runtime connects', {
  timeout: 120_000,
}, async () => {
  const runtime = await kit.boot('test');
  await runtime.stop(1000);
  const control = kit.adapters.adapter('control') as unknown as PgliteAdapter;
  const rows = await control.asOwner(
    async (database) =>
      (
        await database.query<{ id: string; durationMs: number }>(
          `select id, duration_ms as "durationMs" from "kw__control".kw_migrations where track = 'keelwerk.framework' order by id`,
        )
      ).rows,
  );
  expect(rows.map((row) => row.id)).toEqual(['0001', '0002']);
  expect(rows[0]?.durationMs).toBe(0);
  const present = await control.asOwner(
    async (database) =>
      (
        await database.query<{ present: boolean }>(
          `select to_regclass('"kw__control".kw_consumers') is not null as present`,
        )
      ).rows,
  );
  expect(present[0]?.present).toBe(true);
});
