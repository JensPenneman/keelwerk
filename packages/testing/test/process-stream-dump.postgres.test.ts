import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { beforeAll, describe, expect, test } from 'vitest';
import { dumpDatabase, findPlaintext } from '../src/index.ts';
import { bootReactions, relayOwner } from './kernel/support/reactions-kit.ts';
import { createTestDatabase } from './support/create-test-database.ts';

const markers = ['process.marker one', 'ProcessMarkerTwo', 'the process marker note'];

describe('a PostgreSQL dump of a process stream with a personal member (14.10, S-124)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    urls = await createTestDatabase('dump_process_stream');
  }, 120_000);

  test('a dump holds no plaintext of the personal note of a process event', {
    timeout: 120_000,
  }, async () => {
    const kit = await bootReactions({
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
    try {
      for (const contact of markers) {
        expect((await kit.send('acme', { channel: 'dump', contact, owner: relayOwner })).ok).toBe(
          true,
        );
        await kit.settle();
      }
      const noted = (await kit.rows('acme', 'relay.echo')).filter(
        (row) => row.reaction === 'relay.tally',
      );
      expect(noted).toHaveLength(markers.length);
      const client = new pg.Client({ connectionString: urls.adminUrl });
      await client.connect();
      try {
        const dump = await dumpDatabase(async (sql) => (await client.query(sql)).rows);
        // The controls: the process events are in the dump as sealed envelopes, under their stream type.
        const stored = await client.query(
          `select count(*)::int as events from "${kit.runtime.namespace.root}".kw_events where stream_type = 'relay.tally'`,
        );
        expect(stored.rows).toEqual([{ events: markers.length }]);
        expect(dump).toContain('$kwe');
        expect(findPlaintext(dump, ['relay.tally'])).toEqual(['relay.tally']);
        expect(findPlaintext(dump, markers)).toEqual([]);
      } finally {
        await client.end();
      }
    } finally {
      await kit.stop();
    }
  });
});
