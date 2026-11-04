// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { expect, test } from 'vitest';
import { failure } from './support/failure.ts';
import { jobSpec } from './support/job-spec.ts';
import { ownerRows } from './support/owner-rows.ts';
import { storeNamespace } from './support/store-namespace.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';

const store = storeSuite();
const group = { id: 'mx:example.com', scope: 'namespace' as const, concurrency: 2 };

test('provisioning with a namespace group lets a tenant unit enqueue into it, re-limits it and skips groups of other scopes', async () => {
  await store.adapter.schema.provision(storeNamespace, [], {
    jobGroups: [group, { id: 'per-scope', concurrency: 1 }],
  });
  expect(await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec({ group })))).toBe('1');
  await store.adapter.schema.provision(storeNamespace, [], {
    jobGroups: [{ ...group, concurrency: 5 }],
  });
  expect(
    await ownerRows(store.adapter, 'select id, scope_id, concurrency from app.kw_job_groups'),
  ).toEqual([{ id: group.id, scope_id: null, concurrency: 5 }]);
});

test('without the group the enqueue fails with the internal error', async () => {
  await store.adapter.schema.provision(storeNamespace, []);
  const refused = await failure(
    store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec({ group }))),
  );
  expect(refused.kind).toBe('internal');
});
