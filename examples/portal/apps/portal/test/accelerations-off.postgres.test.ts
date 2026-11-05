import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPortalDatabase, type PortalDatabase } from './support/create-portal-database.ts';
import { observing } from './support/observing.ts';
import { portalRest } from './support/portal-rest.ts';
import { scenarioCases } from './support/scenario-cases.ts';
import { type RunningPortal, startPortalPostgres } from './support/start-portal-postgres.ts';

describe.each([
  ['accelerations on', 'portal_on', {}],
  ['rowLocks and notify off', 'portal_off', { rowLocks: false, notify: false }],
] as const)('the portal scenario on PostgreSQL 18 with %s', (name, database, accelerations) => {
  const off = name !== 'accelerations on';
  const lockSeen: boolean[] = [];
  let urls: PortalDatabase;
  let portal: RunningPortal;

  beforeAll(async () => {
    urls = await createPortalDatabase(database);
    portal = await startPortalPostgres({
      ...urls,
      accelerations,
      wrap: (factory) => observing(factory, lockSeen),
    });
  }, 120_000);

  afterAll(() => portal?.stop());

  scenarioCases(() => portalRest(portal.fetch, portal.domains.acme ?? ''));

  test('the kernel took the paths of the setting: row locks only when on, no listener when off', async () => {
    expect(lockSeen.length).toBeGreaterThan(0);
    expect(new Set(lockSeen)).toEqual(new Set([!off]));
    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    try {
      // Only this suite's database: the other variant's listener may still be draining on the shared cluster.
      const listeners = await owner.query(
        "select 1 from pg_stat_activity where application_name like '%-listen' and datname = $1",
        [database],
      );
      if (off) expect(listeners.rowCount).toBe(0);
      else expect(listeners.rowCount).toBeGreaterThan(0);
    } finally {
      await owner.end();
    }
  });
});
