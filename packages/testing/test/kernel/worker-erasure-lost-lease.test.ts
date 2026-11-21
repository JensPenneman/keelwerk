import { lostLeaseWireError } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterAll, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { acmeScope, startWatched, statsOf, workerStart } from './support/worker-kit.ts';

/** The one taker the test lets through while it makes the erasure's job lose its leases. */
const loser = 'probe.losing';
const at = (milliseconds: number): Temporal.Instant => workerStart.add({ milliseconds });

const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
});

/**
 * The job of an erasure command that loses its lease three times (9.5.4) is ended by its taker,
 * which fails the receipt with the lost-lease error (D7). Whether step 1 recorded the erasure
 * before that decides what the receipt reads in the end: a recorded erasure runs to its last step
 * from the ledger, and that step completes the receipt; an erasure that was never recorded never
 * reaches it, so its receipt stays failed. The clock is pinned and every step is a count, a read
 * or a call the test awaits: no loop in the background and no wait decides the outcome.
 */
async function boot() {
  const worker = erasure({ pollMs: 3_600_000 });
  const watched = await startWatched({
    app: erasureDumpApp as never,
    workers: true,
    eventWorkers: [
      consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
      worker,
    ],
    configure: (spy) => {
      spy.refuseTake = (_queue, taker) => taker !== loser;
    },
  });
  const { runtime, spy } = watched;
  stops.push(() => runtime.stop());
  // The start pass of the erasure worker runs in the background; this pass queues behind it, so
  // no start pass is left that could complete the receipt later, while it is still accepted.
  await worker.pass();
  const operator = createLocalClient(runtime as never, {
    principal: testOperator(),
    tenant: 'acme',
  }) as unknown as {
    invoke(action: string, input: unknown, options?: unknown): Promise<Record<string, unknown>>;
  };
  const enrolled = await operator.invoke('probe.enrol', {
    name: 'Ada',
    email: 'lost.lease.marker@example.test',
  });
  const subjectId = String(enrolled.personId);
  const accepted = await operator.invoke(
    'core.eraseSubject',
    { subjectId, reason: 'subjectRequest' },
    { prefer: 'async' },
  );
  const commandId = String(accepted.commandId);
  const scope = acmeScope(runtime);
  const receipt = () =>
    runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.receipts.get(commandId));
  const ledgerTypes = async (): Promise<string[]> =>
    (
      await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
        { readOnly: true },
      )
    ).map((entry) => entry.record.type);
  /** The test's own take, with a lease of one millisecond: the job is running, and its lease passes at the next clock step. */
  const takeAndLose = (step: number) =>
    runtime.adapter
      .unit(runtime.namespace, { level: 'namespace', reason: 'test' }, (unit) =>
        unit.jobs.take('commands', loser, {
          limit: 1,
          capabilitySets: [''],
          maxRevision: 1000,
          leaseMs: 1,
        }),
      )
      .then(async () => expect(await runtime.advanceTo(at(step))).toBe(0));
  /** The runtime's own worker takes the exhausted job and ends it with its receipt. */
  const endJob = async () => {
    spy.refuseTake = undefined;
    await runtime.advanceTo(at(100_000));
    expect(await receipt()).toMatchObject({
      status: 'failed',
      outcome: { ok: false, error: { code: lostLeaseWireError.code } },
    });
  };
  return { worker, runtime, spy, receipt, ledgerTypes, takeAndLose, endJob };
}

describe('an erasure command whose job lost its lease three times (D7, 14.7.5)', () => {
  test('a recorded erasure runs to its last step from the ledger, and that step completes the receipt its taker failed', {
    timeout: 60_000,
  }, async () => {
    const kit = await boot();
    const { spy, runtime } = kit;
    // The runtime's worker takes the job and runs step 1 for real: the record goes to the control
    // ledger and to the sinks. Only the completion unit of that job answers "not granted", once, so
    // it fails with a lost lease and rolls back: the job stays running under its lease.
    let refused = false;
    spy.complete = (attempt) => {
      const erasureJob = spy.takes.some((take) =>
        take.jobs.some(
          (job) =>
            job.attempt.jobId === attempt.jobId &&
            'action' in job.run &&
            job.run.action === 'core.eraseSubject',
        ),
      );
      if (!erasureJob || refused) return undefined;
      refused = true;
      return false;
    };
    // The runtime's worker was blocked from boot, so no sweep of the commit's wake-up has taken the
    // job before the spy stood: whichever sweep takes it now, the spy is already in place.
    spy.refuseTake = undefined;
    await runtime.drainJobs();
    expect(refused).toBe(true);
    // The crash point between the record and the job's end: recorded, job still running.
    expect(await kit.ledgerTypes()).toEqual(['erasure']);
    const stats = await statsOf(runtime, 'commands');
    expect([stats?.due, stats?.running]).toEqual([0, 1]);
    expect((await kit.receipt())?.status).toBe('accepted');
    // The worker's expired lease is the first loss; two takes of the test are the second and third.
    spy.refuseTake = (_queue, taker) => taker !== loser;
    await runtime.advanceTo(at(31_000));
    await kit.takeAndLose(41_000);
    await kit.takeAndLose(51_000);
    expect(await kit.ledgerTypes()).toEqual(['erasure']);
    await kit.endJob();
    await kit.worker.pass();
    expect(await kit.receipt()).toMatchObject({ status: 'completed', outcome: { ok: true } });
    expect(await kit.ledgerTypes()).toContain('erasureCompleted');
  });

  // The order point of the first case (a late start pass) does not apply here: no record exists,
  // so any pass, early or late, finds nothing to finish.
  test('an erasure that was never recorded never reaches its last step, so its receipt stays failed', {
    timeout: 60_000,
  }, async () => {
    const kit = await boot();
    await kit.takeAndLose(10_000);
    await kit.takeAndLose(20_000);
    await kit.takeAndLose(30_000);
    await kit.endJob();
    await kit.worker.pass();
    expect(await kit.ledgerTypes()).toEqual([]);
    expect(await kit.receipt()).toMatchObject({
      status: 'failed',
      outcome: { ok: false, error: { code: lostLeaseWireError.code } },
    });
  });
});
