import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { beforeAll, describe, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { effectTenancyCase } from './support/effect-tenancy-case.ts';

describe('core.effect is scoped to its tenant on PostgreSQL', () => {
  let urls: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    urls = await createTestDatabase('effect_tenancy');
  }, 120_000);

  test("a tenant finds none of the other tenant's effects and cannot update one", {
    timeout: 120_000,
  }, async () => {
    await effectTenancyCase({
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
  });
});
