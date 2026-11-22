import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { commitTailStatement } from '../src/sql/postgres/commit-tail-statement.ts';
import { backend } from './support/backend.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { jobSpec } from './support/job-spec.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { provisionExampleRoots } from './support/provision-example-roots.ts';

/*
 * What decides the case: the plan the database builds for the count of the commit tail, over rows
 * that `JobStore.enqueue` wrote into a root that provisioning built (so with the index of framework
 * step 0005): a tenant's few jobs beside another tenant's many. With sequential scans off it shows
 * whether the index can serve the count at all; without the index the plan reads the table.
 */

const scopeOf = (tenantId: string) => ({ level: 'tenant' as const, backendId: backend, tenantId });
const tenantScope = scopeOf('00000000-0000-4000-8000-0000000000a1');
const crowded = scopeOf('00000000-0000-4000-8000-0000000000a2');
let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await openClockedPglite();
  await provisionExampleRoots(adapter);
  for (const [scope, count] of [
    [crowded, 600],
    [tenantScope, 3],
  ] as const) {
    await adapter.unit(exampleNamespace, scope, async (unit) => {
      for (let n = 0; n < count; n += 1) {
        await unit.jobs.enqueue(jobSpec({ scope, run: { action: 'app.note.set', input: { n } } }));
      }
    });
  }
}, 120_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

test('the count of the commit tail is a range scan of the index of the jobs that wait to run', async () => {
  const statement = commitTailStatement({
    root: 'example',
    scopeId: tenantScope.tenantId,
    backendId: '',
    events: [],
    lanes: [],
    caps: [{ queue: 'commands', cap: 10_000 }],
    usage: [],
  });
  const text = await adapter.asOwner(async (database) => {
    await database.exec('analyze example.kw_jobs; set enable_seqscan = off');
    const answered = await database.query<Record<string, string>>(
      `explain (costs off) ${statement.sql}`,
      [...statement.parameters],
    );
    await database.exec('reset enable_seqscan');
    return answered.rows.map((row) => Object.values(row).join(' ')).join('\n');
  });
  expect(text).toContain('using kw_jobs_queued on kw_jobs');
  expect(text).not.toContain('Seq Scan');
  // The index serves the scope and the queue as its search condition, not as a filter over entries.
  expect(text).toMatch(/Index Cond: \(\(scope_id = '[0-9a-f-]+'::uuid\) AND \(queue = /);
});
