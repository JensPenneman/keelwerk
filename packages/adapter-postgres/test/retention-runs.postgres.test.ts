import { retentionRunCases } from '@keelwerk/testing';
import { storeHarness } from './support/store-harness.ts';

const { run, read, asOwner } = storeHarness('stores_retention_runs');

// The same cases as the conformance suite and the PGlite test, on the real control root.
retentionRunCases(
  { run, read, deploymentId: '00000000-0000-4000-8000-0000000000d1' },
  {
    table: true,
    ownerInsert: (row) =>
      asOwner(
        `insert into kw__control.kw_retention_runs (run_id, started_at, ended_at, backend_id, tenant_id, rule, removed, horizons)
         values ($1::uuid, now(), now(), $2::uuid, $3::uuid, '{"rules":[]}', '{}', '{}')`,
        [row.runId, row.backendId, row.tenantId],
      ),
  },
);
