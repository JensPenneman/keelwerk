import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { beforeAll, describe, expect, test } from 'vitest';
import { dumpDatabase, findPlaintext } from '../src/index.ts';
import { bootPeopleOn } from './kernel/support/personal-kit.ts';
import { createTestDatabase } from './support/create-test-database.ts';

const markers = [
  'dump.marker@example.org',
  'DumpMarkerNick',
  'the dump marker note',
  'Before.Marker@Example.ORG',
];

describe('a PostgreSQL dump of personal fields (14.10)', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    urls = await createTestDatabase('dump_personal');
  }, 120_000);

  test('holds no plaintext personal marker in state tables, events or indexes', {
    timeout: 120_000,
  }, async () => {
    const factory = postgresAdapter({ ownerUrl: urls.adminUrl });
    const people = await bootPeopleOn({ factory, url: urls.appUrl });
    const created = await people.create({
      name: 'Plain Visible Name',
      email: markers[3],
      nickname: markers[1],
      notes: markers[2],
    });
    const updated = await people.call('people.person.update', {
      id: created.id,
      ifVersion: 1,
      email: markers[0],
    });
    expect(updated.ok).toBe(true);
    expect(await people.find({ email: { eq: markers[0]?.toUpperCase() } })).toMatchObject({
      ok: true,
      value: { items: [{ name: 'Plain Visible Name' }] },
    });

    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    try {
      const dump = await dumpDatabase(async (sql) => (await owner.query(sql)).rows);
      // The control: the finder does see the one value stored in the clear.
      expect(findPlaintext(dump, ['Plain Visible Name'])).toEqual(['Plain Visible Name']);
      expect(dump).toContain('$kwe');
      expect(findPlaintext(dump, markers)).toEqual([]);
    } finally {
      await owner.end();
    }
  });
});
