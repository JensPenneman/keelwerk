import { principalRateBuckets } from '@keelwerk/core';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { bootErasureRules, stopBooted } from './support/erasure-rules-kit.ts';

afterEach(stopBooted);

test('after a user is erased no bucket of the tenant is named by their principal, and another user keeps theirs', {
  timeout: 120_000,
}, async () => {
  const { runtime, worker, operator, subject } = await bootErasureRules('pglite');
  const other = String(
    (
      (await operator.invoke('probe.enrol', { name: 'Bea', email: 'bea@example.test' })) as {
        personId: string;
      }
    ).personId,
  );
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const nameOf = async (id: string) => principalRateBuckets(runtime.keys, scope, [id]);
  const query = pgliteQuery(runtime.adapter);
  const stored = async (): Promise<ReadonlySet<string>> => {
    const rows = await query(
      `select convert_from(b.bucket, 'utf8') as bucket from "${await schemaOf(query)}".kw_rate_buckets b`,
    );
    return new Set(rows.map((row) => String(row.bucket)));
  };
  for (const id of [subject, other]) {
    const user = createLocalClient(runtime, { principal: testPrincipal(id), tenant: 'acme' });
    await user.attempt('probe.reachOut', {
      threadId: crypto.randomUUID(),
      to: 'someone',
      deadline: Temporal.Now.instant(),
    } as never);
  }
  const before = await stored();
  const erasedNames = await nameOf(subject);
  const keptNames = await nameOf(other);
  // The user's bucket is there, under the name the admission gave it: the erasure names it the same.
  expect(erasedNames.some((name) => before.has(name))).toBe(true);
  expect(keptNames.some((name) => before.has(name))).toBe(true);

  await operator.invoke(
    'core.eraseSubject',
    { subjectId: subject as never, reason: 'subjectRequest' } as never,
    { prefer: 'async' },
  );
  await runtime.drainJobs();
  await worker.pass();

  const after = await stored();
  expect(erasedNames.filter((name) => after.has(name))).toEqual([]);
  expect(keptNames.filter((name) => before.has(name) && !after.has(name))).toEqual([]);
  // The tenant's own buckets are no principal's: they stay.
  expect(after.size).toBe(before.size - erasedNames.filter((name) => before.has(name)).length);
});

async function schemaOf(query: ReturnType<typeof pgliteQuery>): Promise<string> {
  const rows = await query(
    "select table_schema from information_schema.tables where table_name = 'kw_rate_buckets' limit 1",
  );
  return String(rows[0]?.table_schema);
}
