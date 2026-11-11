import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { appendStreamRecords } from '@keelwerk/core';
import pg from 'pg';
import { beforeAll, describe, expect, test } from 'vitest';
import { dumpDatabase, findPlaintext } from '../src/index.ts';
import { bootJournal } from './kernel/support/journal-kit.ts';
import { createTestDatabase } from './support/create-test-database.ts';

const markers = ['stream.marker one', 'StreamMarkerTwo', 'the stream marker line'];

describe('a PostgreSQL dump of stream records with a personal member (14.10)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    urls = await createTestDatabase('dump_stream_records');
  }, 120_000);

  test('a dump holds no plaintext personal marker of a stream record', {
    timeout: 120_000,
  }, async () => {
    const journal = await bootJournal({
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
    try {
      const written = await journal.call<{ pageId: string }>('journal.writePage', {
        title: 'Dump Visible Title',
        texts: [markers[0], markers[1]],
      });
      expect(written).toMatchObject({ ok: true });
      const pageId = (written as { value: { pageId: string } }).value.pageId;
      expect(await journal.call('journal.append', { pageId, text: markers[2] })).toMatchObject({
        ok: true,
      });
      const owner = new pg.Client({ connectionString: urls.adminUrl });
      await owner.connect();
      try {
        const dump = await dumpDatabase(async (sql) => (await owner.query(sql)).rows);
        // The controls: the finder sees the plain title, the plain `n` is stored in the clear and
        // the personal member is an envelope.
        expect(findPlaintext(dump, ['Dump Visible Title'])).toEqual(['Dump Visible Title']);
        const plain = await owner.query(
          `select data->'record'->>'n' as n from "${journal.runtime.namespace.root}".kw_stream_records
           where data->'record'->>'n' = '100'`,
        );
        expect(plain.rows).toEqual([{ n: '100' }]);
        expect(dump).toContain('$kwe');
        expect(findPlaintext(dump, markers)).toEqual([]);
      } finally {
        await owner.end();
      }
    } finally {
      await journal.runtime.stop();
    }
  });

  test('a dump holds no plaintext of the error of a failed effect attempt', {
    timeout: 120_000,
  }, async () => {
    const own = await createTestDatabase('dump_effect_attempt');
    const journal = await bootJournal({
      external: { factory: postgresAdapter({ ownerUrl: own.adminUrl }), url: own.appUrl },
    });
    try {
      const effectId = crypto.randomUUID();
      const scope = {
        level: 'tenant',
        backendId: journal.runtime.backendId,
        tenantId: journal.tenant.id,
      } as const;
      const attempt = (error: object) => ({
        kind: 'append',
        type: 'append',
        target: 'core.effectAttempt',
        stream: 'core.effectAttempt',
        key: effectId,
        records: [
          { process: 'mail', build: 'b1', attempt: 1, startedAt: '2026-11-11T10:00:00Z', error },
        ],
      });
      const projection = {
        kind: 'unavailable',
        code: 'mail.rejected',
        retryable: true,
        requestId: crypto.randomUUID(),
      };
      const append = (error: object) =>
        journal.runtime.sealed.unit(journal.runtime.namespace, scope, (unit) =>
          appendStreamRecords({
            registry: journal.runtime.app.registry,
            unit,
            authority: 'core',
            appends: [attempt(error) as never],
          }),
        );
      // The executor's reply quotes an address: the record refuses it, so it is never written.
      await expect(
        append({ ...projection, message: '550 5.1.1 <bob.attempt@example.com>: rejected' }),
      ).rejects.toMatchObject({ kind: 'validation' });
      await append(projection);
      const owner = new pg.Client({ connectionString: own.adminUrl });
      await owner.connect();
      try {
        const dump = await dumpDatabase(async (sql) => (await owner.query(sql)).rows);
        expect(findPlaintext(dump, ['mail.rejected'])).toEqual(['mail.rejected']);
        expect(findPlaintext(dump, ['bob.attempt@example.com', '5.1.1'])).toEqual([]);
      } finally {
        await owner.end();
      }
    } finally {
      await journal.runtime.stop();
    }
  });
});
