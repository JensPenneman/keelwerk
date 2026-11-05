import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, beforeAll, describe } from 'vitest';
import { createPortalDatabase } from './support/create-portal-database.ts';
import { restIsolationCases, storeIsolationCases } from './support/isolation-cases.ts';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { portalRest } from './support/portal-rest.ts';
import { scenarioCases } from './support/scenario-cases.ts';
import { type RunningPortal, startPortalPostgres } from './support/start-portal-postgres.ts';

describe('the portal scenario on PostgreSQL 18', () => {
  let portal: RunningPortal;
  let local: LocalPortal;

  beforeAll(async () => {
    const urls = await createPortalDatabase('portal_scenario');
    portal = await startPortalPostgres(urls);
    const store = await createPortalDatabase('portal_store');
    local = await startLocalPortal({
      factory: postgresAdapter({ ownerUrl: store.adminUrl }),
      url: store.appUrl,
    });
  }, 120_000);

  afterAll(async () => {
    await portal?.stop();
    await local?.runtime.stop();
  });

  scenarioCases(() => portalRest(portal.fetch, portal.domains.acme ?? ''));
  restIsolationCases(
    (name) => portalRest(portal.fetch, portal.domains[name] ?? ''),
    () => portal.tenants,
  );
  storeIsolationCases(() => local);
});
