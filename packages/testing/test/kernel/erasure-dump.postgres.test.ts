import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { erasure } from '@keelwerk/events';
import pg from 'pg';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { runErasureDumpCase } from './support/erasure-dump-case.ts';
import { dumpDispatcher } from './support/erasure-dump-markers.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { dumpTime } from './support/erasure-usage-flush.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

describe('a PostgreSQL dump after erasing a subject planted through every path (criterion 5, first half)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    urls = await createTestDatabase('erasure_dump');
  }, 120_000);
  afterAll(() => undefined);

  test('the inventory names every table, the key is gone and no marker survives', {
    timeout: 240_000,
  }, async () => {
    const time = dumpTime();
    const dispatcher = dumpDispatcher();
    const worker = erasure({ pollMs: 3_600_000 });
    const runtime = await startTestRuntime(erasureDumpApp, {
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
      operators: true,
      clock: time.clock,
      timers: time.timers,
      workers: true,
      eventWorkers: [dispatcher, worker],
    });
    const client = new pg.Client({ connectionString: urls.adminUrl });
    await client.connect();
    try {
      // One database holds the control root and the placement.
      await runErasureDumpCase({
        runtime,
        worker,
        dispatcher,
        advance: time.advance,
        queries: [async (sql) => (await client.query(sql)).rows],
      });
    } finally {
      await client.end();
      await runtime.stop();
    }
  });
});
