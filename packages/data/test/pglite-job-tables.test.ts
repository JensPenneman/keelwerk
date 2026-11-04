import type { StorageScope } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { backendScope } from './support/backend-scope.ts';
import { inUnit } from './support/in-unit.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { seedTenants } from './support/seed-tenants.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await provisionedPglite();
  await seedTenants(adapter);
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

describe('job groups and lanes on PGlite', () => {
  test('a group without a scope is visible to every unit, a scoped group only to its scope', async () => {
    await inUnit(adapter, namespaceScope, async (u) =>
      runStatement(
        u,
        `insert into ${ns}.kw_job_groups (id, scope_id) values ('mx:example.com', null)`,
      ),
    );
    const ids = async (scope: StorageScope): Promise<string[]> =>
      inUnit(adapter, scope, async (u) =>
        (await runStatement(u, `select id from ${ns}.kw_job_groups order by id`)).rows.map((row) =>
          String(row.id),
        ),
      );
    expect(await ids(storageTenant(tenantA))).toEqual([`g:${tenantA}`, 'mx:example.com']);
    expect(await ids(backendScope)).toEqual(['mx:example.com']);
    expect(await ids(namespaceScope)).toHaveLength(3);
  });

  const failsForeignKey = async (text: string, values: unknown[]): Promise<void> => {
    await expect(
      inUnit(adapter, storageTenant(tenantA), async (u) => runStatement(u, text, values)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|42501)$/) });
  };

  test("a tenant unit cannot attach a job to another tenant's lane", async () => {
    const laneOfB = (
      await inUnit(adapter, storageTenant(tenantB), async (u) =>
        runStatement(u, `select id::text as id from ${ns}.kw_job_lanes`),
      )
    ).rows[0]?.id;
    await failsForeignKey(
      `insert into ${ns}.kw_jobs (scope_id, lane_id, queue, kind, state, principal, causation, build_id, revision, input, created_at)
       values ($1, $2, 'q', 'action', 'available', '{}', '{}', 'b', 1, '{}', now())`,
      [tenantA, laneOfB],
    );
  });

  test("a tenant unit cannot attach a count row to another tenant's lane", async () => {
    // A fresh lane has no counters yet, so the primary key cannot answer before the foreign key does.
    const fresh = (
      await inUnit(adapter, namespaceScope, async (u) =>
        runStatement(
          u,
          `insert into ${ns}.kw_job_lanes (scope_id, queue, capability_set, priority, cap, weight)
           values ($1, 'q2', 'c', 1, 5, 1) returning id::text as id`,
          [tenantB],
        ),
      )
    ).rows[0]?.id;
    await failsForeignKey(
      `insert into ${ns}.kw_job_lane_counts (lane_id, kind, scope_id, value) values ($2, 'enqueued', $1, 0)`,
      [tenantA, fresh],
    );
  });
});
