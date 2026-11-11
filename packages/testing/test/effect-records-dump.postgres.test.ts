import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { SubjectId } from '@keelwerk/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { dumpDatabase, findPlaintext } from '../src/index.ts';
import { startHookEndpoint } from './kernel/support/hook-endpoint.ts';
import { bootHooks, probeInput } from './kernel/support/hooks-kit.ts';
import { drainHooks, effectOf, rowsOf } from './kernel/support/hooks-reads.ts';
import { createTestDatabase } from './support/create-test-database.ts';

const personal = 'ada.personal-marker@example.org';
const payload = 'a payload that is only a body';
const owner = crypto.randomUUID() as SubjectId;

describe('a PostgreSQL dump of settled effects (7.9.6, lead 2)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  const stops: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    urls = await createTestDatabase('dump_effect_records');
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  });

  test('the hooks sketch and an executor error that quotes a personal input value leave no plaintext in the dump', {
    timeout: 120_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    stops.push(() => endpoint.close());
    const booted = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
    stops.push(() => booted.runtime.stop());
    await booted.client.invoke('hooks.notify', { payload });
    await booted.client.invoke('probes.run', probeInput(owner, 'validation', { note: personal }));
    await booted.client.invoke(
      'probes.run',
      probeInput(owner, 'quote', { note: personal, group: 'other' }),
    );
    await drainHooks(booted);
    expect(await effectOf(booted, 'hooks.post')).toMatchObject({ status: 'succeeded' });
    const failed = (await rowsOf(booted, 'core.effect')).filter((row) => row.status === 'failed');
    expect(failed).toHaveLength(2);

    const client = new pg.Client({ connectionString: urls.adminUrl });
    await client.connect();
    try {
      const dump = await dumpDatabase(async (sql) => (await client.query(sql)).rows);
      // The controls: the finder sees what is stored in the clear, and the personal value is sealed.
      expect(findPlaintext(dump, [payload])).toEqual([payload]);
      expect(dump).toContain('$kwe');
      expect(findPlaintext(dump, [personal])).toEqual([]);
      // The signing key lives sealed under the backend key, never as the plain configuration value.
      expect(findPlaintext(dump, ['hook-signing-key'])).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
