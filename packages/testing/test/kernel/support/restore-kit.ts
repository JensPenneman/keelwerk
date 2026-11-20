import { erasure } from '@keelwerk/events';
import type pg from 'pg';
import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { erasureDumpApp } from './erasure-probe-module.ts';
import { memorySink } from './memory-sink.ts';
import { type RestartRuntime as Runtime, useRestartDatabase } from './restart-kit.ts';

/** The SQLSTATE of a deadlock; the transaction is rolled back and can run again. */
const deadlockDetected = '40P01';
const maxRestoreAttempts = 5;
/** The deadline a stop gets: it waits for the services to finish and closes the adapters. */
export const stopMs = 10_000;

/**
 * What the restore tests on PostgreSQL share: the database of `useRestartDatabase`, a backup of a
 * namespace, an erasure of a subject taken after it, and a runtime started again on the same
 * database. Call it inside a `describe`; `app` is the app the first runtime runs.
 */
export function useRestoreKit(app: typeof erasureDumpApp = erasureDumpApp) {
  const database = useRestartDatabase();
  const { stops, external, dispatcher, owner, joined } = database;

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
    const runtime = await startTestRuntime(app, {
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
    const first = await startTestRuntime(app, {
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

  return { ...database, completionEpochs, startAgain, eraseAfterBackup };
}
