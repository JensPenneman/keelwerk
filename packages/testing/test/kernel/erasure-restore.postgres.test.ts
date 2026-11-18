import { erasure } from '@keelwerk/events';
import type pg from 'pg';
import { describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { memorySink } from './support/memory-sink.ts';
import {
  insertUnfencedThread,
  kernelRows,
  type RestartRuntime as Runtime,
  useRestartDatabase,
} from './support/restart-kit.ts';

/** The SQLSTATE of a deadlock; the transaction is rolled back and can run again. */
const deadlockDetected = '40P01';
const maxRestoreAttempts = 5;
/** The deadline a stop gets: it waits for the services to finish and closes the adapters. */
const stopMs = 10_000;

describe('a placement restored from a backup on PostgreSQL (14.7.5 step 6, 14.7.6)', () => {
  const { stops, external, dispatcher, owner, seedAda, inTenant, joined } = useRestartDatabase();

  /**
   * A copy of every table of the namespace's schema, taken now: the backup. `restore` puts the
   * copies back, all of them or the tables a filter keeps (the control store is another schema and
   * is never restored: it is what the restore leaves behind).
   */
  async function backUp(runtime: Runtime, client: pg.Client) {
    const schema = runtime.namespace.root;
    const tables = (
      await client.query(`select tablename from pg_tables where schemaname = $1 order by 1`, [
        schema,
      ])
    ).rows.map((row: { tablename: string }) => row.tablename);
    const copy = `backup_${schema.replace(/\W/g, '_')}`;
    await client.query(`create schema if not exists "${copy}"`);
    for (const [index, table] of tables.entries()) {
      await client.query(`create table "${copy}".t${index} as table "${schema}"."${table}"`);
    }
    return {
      tables,
      restore: async (keep: (table: string) => boolean = () => true): Promise<void> => {
        const kept = tables.filter(keep);
        // The runtime was stopped with a deadline, so it has finished its work. A session that still
        // held a lock would end the truncate in a deadlock, which rolls the transaction back as a
        // whole: the restore is one transaction and runs again.
        for (let attempt = 1; ; attempt += 1) {
          try {
            await client.query('begin');
            await client.query('set local session_replication_role = replica');
            await client.query(
              `truncate ${kept.map((table) => `"${schema}"."${table}"`).join(', ')}`,
            );
            for (const table of kept) {
              const index = tables.indexOf(table);
              await client.query(
                `insert into "${schema}"."${table}" overriding system value select * from "${copy}".t${index}`,
              );
            }
            await client.query('commit');
            return;
          } catch (error) {
            await client.query('rollback');
            const code = (error as { readonly code?: string }).code;
            if (code !== deadlockDetected || attempt === maxRestoreAttempts) throw error;
          }
        }
      },
    };
  }

  const completionEpochs = async (runtime: Runtime): Promise<number[]> =>
    (
      await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
        { readOnly: true },
      )
    ).flatMap((entry) => (entry.record.type === 'erasureCompleted' ? [entry.record.epoch] : []));

  /** A runtime on the database of `first`, with an erasure worker whose steps are collected. */
  async function startAgain(first: Runtime, sink: ReturnType<typeof memorySink>) {
    const steps: string[] = [];
    const runtime = await startTestRuntime(erasureDumpApp, {
      external: external(),
      operators: true,
      workers: true,
      ledgers: [sink],
      join: joined(first),
      eventWorkers: [
        dispatcher(),
        erasure({
          pollMs: 3_600_000,
          afterStep: async (step) => {
            steps.push(step);
          },
        }),
      ],
    });
    stops.push(() => runtime.stop());
    return { runtime, steps };
  }

  /** Runs one erasure of `subject` to its end on a fresh runtime that was backed up first. */
  async function eraseAfterBackup(
    subject: (runtime: Runtime) => Promise<string>,
    afterErase: (runtime: Runtime) => Promise<void>,
  ) {
    const sink = memorySink();
    const worker = erasure({ pollMs: 3_600_000 });
    const first = await startTestRuntime(erasureDumpApp, {
      external: external(),
      operators: true,
      workers: true,
      ledgers: [sink],
      eventWorkers: [dispatcher(), worker],
    });
    stops.push(() => first.stop());
    const client = await owner();
    const id = await subject(first);
    const backup = await backUp(first, client);
    const operator = createLocalClient(first, { principal: testOperator(), tenant: 'acme' });
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: id as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await first.drainJobs();
    await worker.pass();
    expect(await completionEpochs(first)).toEqual([0]);
    await afterErase(first);
    await first.stop(stopMs);
    return { sink, first, id, backup, client };
  }
  test('a placement restored from before the erasure erases the rows again and appends a second completion', {
    timeout: 240_000,
  }, async () => {
    const { sink, first, id, backup } = await eraseAfterBackup(
      async (runtime) => (await seedAda(runtime)).ada,
      async (runtime) => {
        expect((await kernelRows(runtime, 'probe.person'))[0]?.kwErasedAt ?? null).not.toBeNull();
      },
    );
    // Every table of the namespace is restored: the rows, the keys and the receipts as they were.
    // The control store keeps the erasure record, the tombstones and the completion.
    await backup.restore();
    const { runtime: again, steps } = await startAgain(first, sink);
    expect(steps).toContain('shred');
    const rows = await kernelRows(again, 'probe.person');
    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(rows[0]?.kwErasedAt ?? null).not.toBeNull();
    expect(
      await inTenant(again, (unit) => unit.keys.dataKey(id, { create: false })),
    ).toBeUndefined();
    // The restore is detected (the counters lie below the mark written before the completion): the
    // tenant moves from epoch 0 to epoch 2, and the completion of epoch 0 no longer counts.
    expect(await completionEpochs(again)).toEqual([0, 2]);
  });

  test('a placement restored with only its rows, the keys and the counters left as they were, shows no restore and runs nothing; a bumped epoch runs it', {
    timeout: 240_000,
  }, async () => {
    const { sink, first, id, backup, client } = await eraseAfterBackup(
      async (runtime) => (await seedAda(runtime)).ada,
      async () => undefined,
    );
    // The counters are left as they were too: a restore that leaves no counter below its mark is
    // the one case the epoch cannot see (identity, timeline and anchors apply).
    await backup.restore(
      (table) => !['kw_subject_keys', 'kw_value_keys', 'kw_positions'].includes(table),
    );
    const unchanged = await startAgain(first, sink);
    // The keys are still destroyed and the boot destroys nothing: nothing shows a restore.
    expect(unchanged.steps).toEqual([]);
    const restored = await kernelRows(unchanged.runtime, 'probe.person');
    expect(restored.map((row) => row.id)).toEqual([id]);
    expect(restored[0]?.kwErasedAt ?? null).toBeNull();
    expect(await completionEpochs(unchanged.runtime)).toEqual([0]);
    await unchanged.runtime.stop(stopMs);

    // The epoch a detected restore bumps (here moved by hand in the control store): the erasure runs again.
    await client.query(`update "kw__control".kw_scope_marks set epoch = 1 where scope_id = $1`, [
      first.tenants.acme?.id ?? '',
    ]);
    const bumped = await startAgain(first, sink);
    expect(bumped.steps).toContain('shred');
    expect(
      (await kernelRows(bumped.runtime, 'probe.person'))[0]?.kwErasedAt ?? null,
    ).not.toBeNull();
    expect(await completionEpochs(bumped.runtime)).toEqual([0, 1]);
  });

  test('a subject that owns only a row without a personal value has no key; a placement restored from before its erasure erases the row again and refuses a new one', {
    timeout: 240_000,
  }, async () => {
    const { sink, first, id, backup, client } = await eraseAfterBackup(
      async (runtime) => {
        const passkeyUser = crypto.randomUUID();
        // The row seals nothing, as one written before the fence existed: the subject has no key.
        await insertUnfencedThread(runtime, passkeyUser);
        expect(
          await inTenant(runtime, (unit) => unit.keys.dataKey(passkeyUser, { create: false })),
        ).toBeUndefined();
        return passkeyUser;
      },
      async (runtime) => {
        expect((await kernelRows(runtime, 'probe.thread'))[0]?.kwErasedAt ?? null).not.toBeNull();
      },
    );

    // The backup holds the row and no key row of the subject; the control store is not restored.
    await backup.restore();
    const keyRows = await client.query(
      `select count(*)::int as n from "${first.namespace.root}".kw_subject_keys where subject_id = $1`,
      [id],
    );
    expect(keyRows.rows[0]?.n).toBe(0);
    const { runtime: again, steps } = await startAgain(first, sink);
    // The boot replay made the key row the erasure's step 2 makes, and destroyed it after the
    // completion: the worker runs steps 2 to 6 again.
    expect(steps).toContain('shred');
    const rows = await kernelRows(again, 'probe.thread');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kwErasedAt ?? null).not.toBeNull();
    expect(await completionEpochs(again)).toEqual([0, 2]);
    const operator = createLocalClient(again, { principal: testOperator(), tenant: 'acme' });
    const outcome = await operator.attempt('probe.open', { ownerId: id as never, title: 'new' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
  });
});
