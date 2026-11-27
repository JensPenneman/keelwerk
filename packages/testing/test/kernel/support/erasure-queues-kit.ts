import type { LedgerSink, Scope, Unit } from '@keelwerk/core';
import { consumers, type ErasureOptions, erasure, reactionDispatcher } from '@keelwerk/events';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import type { LoggedLine } from '../../../src/harness/logged-line.ts';
import { recordingLogger } from '../../../src/harness/recording-logger.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import { pgliteQuery } from './dump-sections.ts';
import { erasureQueuesApp, queuesControl } from './erasure-queues-module.ts';

let current: TestRuntime<typeof erasureQueuesApp> | undefined;

/** Stops the runtime the last `bootQueues` started; the tests call it after each case. */
export async function stopQueues(): Promise<void> {
  await current?.stop();
  current = undefined;
}

/**
 * A PGlite runtime of the probe app with the queues module, the erasure worker and the reaction
 * dispatcher, on a clock frozen at the start (a retry stays waiting until `advanceTo`), with one
 * person: the subject. `lines` holds every line the runtime logged.
 */
export async function bootQueues(
  options: {
    readonly ledgers?: readonly LedgerSink[];
    /** The test seams of the erasure worker. */
    readonly erasure?: ErasureOptions;
  } = {},
) {
  const lines: LoggedLine[] = [];
  queuesControl.seen.length = 0;
  queuesControl.decided.length = 0;
  queuesControl.executed = 0;
  const start = Temporal.Now.instant();
  const worker = erasure({ pollMs: 3_600_000, ...options.erasure });
  const dispatcher = consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
  const runtime = await startTestRuntime(erasureQueuesApp, {
    adapter: 'pglite',
    clock: { now: () => start },
    operators: true,
    logger: recordingLogger(lines),
    workers: true,
    eventWorkers: [dispatcher, worker],
    ...(options.ledgers === undefined ? {} : { ledgers: options.ledgers }),
  });
  current = runtime;
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const enrolled = await operator.invoke('probe.enrol', {
    name: 'Ada',
    email: 'queues.ada@example.test',
  });
  const subject = String((enrolled as { personId: string }).personId);
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  return {
    lines,
    runtime,
    worker,
    dispatcher,
    operator,
    subject,
    start,
    /** A client for a user principal: the subject itself, or another. */
    userClient: (principal: string) =>
      createLocalClient(runtime, { principal: testPrincipal(principal), tenant: 'acme' }),
    /** Erases the subject as the operator and runs every job and the worker's pass. */
    erase: async (subjectId: string): Promise<void> => {
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: subjectId as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await worker.pass();
      await runtime.drainJobs();
    },
    /** Moves the clock on and lets every worker run what is due. */
    later: async (after: Temporal.DurationLike): Promise<void> => {
      await runtime.advanceTo(start.add(after));
      await dispatcher.settled();
      await runtime.drainJobs();
    },
    inTenant: <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
      runtime.sealed.unit(runtime.namespace, scope, fn),
    /** The rows of a framework table of the tenant namespace, as stored (below the sealing layer). */
    framework: async (table: 'kw_jobs' | 'kw_job_history'): Promise<Record<string, unknown>[]> => {
      const query = pgliteQuery(runtime.adapter);
      const rows: Record<string, unknown>[] = [];
      for (const { schemaname } of await query(
        `select schemaname from pg_tables where tablename = '${table}'`,
      )) {
        rows.push(...(await query(`select * from "${String(schemaname)}"."${table}"`)));
      }
      return rows;
    },
    /** The rows of a `core.*` or module entity, with the erased ones. */
    rowsOf: (ref: string) =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const entry = runtime.app.registry.entities.get(ref);
        if (entry === undefined) throw new Error(`no entity ${ref}`);
        return (await unit.rows.find(entry.descriptor, { includeArchived: true })).rows;
      }),
  };
}
