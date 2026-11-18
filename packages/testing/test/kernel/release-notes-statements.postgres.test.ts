import { randomUUID } from 'node:crypto';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { loopApp } from './support/loop-module.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { acmeScope, jobOf } from './support/worker-kit.ts';

/**
 * The statements of the release notes, section "Security: password digests at rest in 0.1.0",
 * as written: `<ns>` is the namespace schema and `<instant of the upgrade>` the instant of the
 * upgrade. They run as the owner role.
 */
const statements = `
begin;
set local keelwerk.scope = 'namespace';
-- receipts still in the 0.1.0 form
select status, count(*) from "<ns>".core__command_receipt
 where fingerprint ~ '^[0-9a-f]{64}$' group by status;
-- receipts are operational records (15.1.7): delete every finished one whose window is over
delete from "<ns>".core__command_receipt
 where expires_at < now() and status in ('completed', 'failed');
-- job rows written before the upgrade
select id, queue, state, input->>'action' as action, created_at
  from "<ns>".kw_jobs where created_at < timestamptz '<instant of the upgrade>';
-- dead letters written before the upgrade (a dead row holds no lane count: its enqueued count was
-- settled when a worker took it and its done count when the attempt ended, so the delete moves no lane)
delete from "<ns>".kw_jobs where state = 'dead' and created_at < timestamptz '<instant of the upgrade>';
commit;
`;

const upgrade = '2026-06-01T00:00:00Z';
const before = Temporal.Instant.from('2026-03-01T08:00:00Z');
const after = Temporal.Instant.from('2026-12-31T08:00:00Z');
const far = Temporal.Instant.from('2030-01-01T00:00:00Z');
const bare = (letter: string) => letter.repeat(64);

describe('the operator statements of the 0.2.0 release notes on PostgreSQL', () => {
  let client: pg.Client;
  let runtime: Awaited<ReturnType<typeof boot>>;
  const ns = 'conformance';
  const lanes = async () =>
    (
      await client.query(
        `select lane_id::text as lane, kind, value::int as value from "${ns}".kw_job_lane_counts order by lane_id, kind`,
      )
    ).rows;
  const jobs = async () =>
    (
      (await client.query(
        `begin; set local keelwerk.scope = 'namespace'; select id::text, state, created_at as "createdAt" from "${ns}".kw_jobs order by created_at, id; commit;`,
      )) as unknown as { rows: { id: string; state: string; createdAt: Date }[] }[]
    )[2]?.rows ?? [];
  const receipts = async () =>
    (
      (await client.query(
        `begin; set local keelwerk.scope = 'namespace'; select command_id as "commandId", status, fingerprint from "${ns}".core__command_receipt where action = 'loans.openDesk' order by command_id; commit;`,
      )) as unknown as { rows: { commandId: string; status: string; fingerprint: string }[] }[]
    )[2]?.rows ?? [];

  async function boot() {
    const urls = await createTestDatabase('release_notes');
    client = new pg.Client({ connectionString: urls.adminUrl });
    await client.connect();
    return startTestRuntime(conformanceApp, {
      tenants: ['acme'],
      operators: true,
      workers: true,
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
  }

  const enqueue = (over: Parameters<typeof jobOf>[1]) =>
    runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
      unit.jobs.enqueue(jobOf(runtime, over)),
    );
  const ids = {
    gone: randomUUID(),
    goneFailed: randomUUID(),
    kept: randomUUID(),
    accepted: randomUUID(),
  };

  beforeAll(async () => {
    runtime = await boot();
    const carrier = testCarrier(runtime.tenants.acme, testOperator('olive'));
    for (const [desk, commandId] of Object.entries(ids)) {
      const outcome = await runtime.invoker.invoke({
        action: 'loans.openDesk',
        input: { desk },
        carrier,
        requestId: randomUUID(),
        commandId,
        signal: new AbortController().signal,
      });
      expect(outcome.ok).toBe(true);
    }
    // Receipts as 0.1.0 wrote them: the plain SHA-256 of the input, two of them past their window.
    const plant = (commandId: string, status: string, expires: string, fingerprint: string) =>
      client.query(
        `begin; set local keelwerk.scope = 'namespace';
         update "${ns}".core__command_receipt set status = '${status}', fingerprint = '${fingerprint}', expires_at = now() + interval '${expires}' where command_id = '${commandId}'; commit;`,
      );
    await plant(ids.gone, 'completed', '-2 days', bare('a'));
    await plant(ids.goneFailed, 'failed', '-2 days', bare('b'));
    await plant(ids.kept, 'completed', '1 day', bare('c'));
    await plant(ids.accepted, 'accepted', '-2 days', bare('d'));
    // A job from before the upgrade that waits, a dead letter from before it, and one from after.
    await enqueue({ queue: 'commands', runAt: far, createdAt: before });
    await enqueue({
      queue: 'commands',
      principal: { resolver: 'ghost.resolver', principalId: 'nobody' },
      deadLetter: 'commands-dead',
      createdAt: before,
    });
    await enqueue({
      queue: 'commands',
      principal: { resolver: 'ghost.resolver', principalId: 'nobody' },
      deadLetter: 'commands-dead',
      createdAt: after,
    });
    await runtime.drainJobs();
  }, 120_000);

  afterAll(async () => {
    await client.end();
    await runtime.stop();
  });

  test('each statement runs as written, deletes what its comment says and moves no lane count', async () => {
    const planted = await jobs();
    expect(planted.map((job) => job.state).sort()).toEqual(['dead', 'dead', 'scheduled']);
    expect((await receipts()).map((row) => [row.status, row.fingerprint.length]).sort()).toEqual([
      ['accepted', 64],
      ['completed', 64],
      ['completed', 64],
      ['failed', 64],
    ]);
    const laneBefore = await lanes();
    expect(laneBefore.length).toBeGreaterThan(0);
    const results = (await client.query(
      statements.replaceAll('<ns>', ns).replaceAll('<instant of the upgrade>', upgrade),
    )) as unknown as { rows: Record<string, unknown>[] }[];
    // The receipts still in the 0.1.0 form, by status, as the first select lists them.
    const listed = Object.fromEntries(
      results[2]?.rows.map((row) => [row.status, Number(row.count)]) ?? [],
    );
    expect(listed).toEqual({ accepted: 1, completed: 2, failed: 1 });
    // The two receipts past their window and finished are gone; the accepted one and the one in its
    // window stay.
    expect((await receipts()).map((row) => row.commandId).sort()).toEqual(
      [ids.kept, ids.accepted].sort(),
    );
    // The listing of job rows written before the upgrade names the waiting row and the dead letter.
    expect(results[4]?.rows.map((row) => row.state).sort()).toEqual(['dead', 'scheduled']);
    expect(results[4]?.rows.every((row) => row.action === 'loans.closeAll')).toBe(true);
    // The delete removes the dead letter from before the upgrade only.
    const left = await jobs();
    expect(left.map((job) => job.state).sort()).toEqual(['dead', 'scheduled']);
    expect(left.find((job) => job.state === 'dead')?.createdAt.toISOString()).toBe(
      after.toString().replace('Z', '.000Z'),
    );
    expect(await lanes()).toEqual(laneBefore);
  });

  test('the lane admits and runs a job after the delete, and its counters move by that job alone', async () => {
    const laneBefore = await lanes();
    await enqueue({
      queue: 'commands',
      run: { action: 'loans.openDesk', input: { desk: 'south' }, commandId: 'after-delete' },
      principal: { resolver: 'core.module', principalId: 'loans.system' },
    });
    expect(await runtime.drainJobs()).toBeGreaterThanOrEqual(1);
    const receipt = (await receipts()).find((row) => row.commandId === 'after-delete');
    expect(receipt?.status).toBe('completed');
    const laneAfter = await lanes();
    const moved = laneAfter.filter((row, index) => row.value !== laneBefore[index]?.value);
    expect(moved.map((row) => row.kind).sort()).toEqual(['done', 'enqueued']);
    for (const row of moved) {
      expect(row.value).toBe(
        (laneBefore.find((old) => old.lane === row.lane && old.kind === row.kind)?.value ?? 0) + 1,
      );
    }
  });
});

/** The query of the release notes, point 3: the decision records that 0.1.0 wrote, as written. */
const decisionQuery = (ns: string) =>
  `begin; set local keelwerk.scope = 'namespace';
   select count(*) from "${ns}".kw_events where meta->'decision'->>'inputDigest' ~ '^[0-9a-f]{64}$'; commit;`;
const countOf = (result: unknown) =>
  Number((result as { rows: { count: string }[] }[])[2]?.rows[0]?.count);

describe('the query for the decision records of 0.1.0 on PostgreSQL', () => {
  let client: pg.Client;
  let kit: Awaited<ReturnType<typeof bootReactions>>;
  let ns = '';
  const digests = async (like: string) =>
    countOf(
      await client.query(
        `begin; set local keelwerk.scope = 'namespace';
         select count(*) from "${ns}".kw_events where meta->'decision'->>'inputDigest' like '${like}'; commit;`,
      ),
    );

  beforeAll(async () => {
    const urls = await createTestDatabase('release_notes_decisions');
    client = new pg.Client({ connectionString: urls.adminUrl });
    await client.connect();
    kit = await bootReactions({
      app: loopApp,
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
    ns = kit.runtime.namespace.root;
    // A command whose inline reaction writes an event: the command's pulse carries a kwb1 decision
    // and the reaction's beat a kwr1 one. Nothing settles the asynchronous reactions of the chain.
    const outcome = await kit.call('acme', 'loop.emitPulse', { via: 'inline', n: 0 });
    expect(outcome.ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await client.end();
    await kit.stop();
  });

  test('finds the decision record in the form of 0.1.0 and none of this build, which the reaction writes tagged', async () => {
    expect(await digests('kwr1.%')).toBeGreaterThanOrEqual(1);
    expect(await digests('kwb1.%')).toBeGreaterThanOrEqual(1);
    // This build's own records hold no 64 bare hexadecimal characters.
    expect(countOf(await client.query(decisionQuery(ns)))).toBe(0);
    // Plant one record as 0.1.0 wrote it: the bare SHA-256 of the input in the decision.
    const planted = await client.query(
      `begin; set local keelwerk.scope = 'namespace';
       update "${ns}".kw_events set meta = jsonb_set(meta, '{decision,inputDigest}', to_jsonb('${bare('e')}'::text))
        where event_id = (select event_id from "${ns}".kw_events where meta->'decision'->>'inputDigest' like 'kwb1.%' limit 1); commit;`,
    );
    expect((planted as unknown as { rowCount: number }[])[2]?.rowCount).toBe(1);
    expect(countOf(await client.query(decisionQuery(ns)))).toBe(1);
    expect(await digests('kwr1.%')).toBeGreaterThanOrEqual(1);
  });
});
