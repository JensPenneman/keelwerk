import { errors } from '@keelwerk/core';
import { afterAll, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import {
  acmeScope,
  askCloseAll,
  startWatched,
  statsOf,
  workerStart,
} from './support/worker-kit.ts';

const commandId = '00000000-0000-7000-8000-000000000041';
/** The one taker the test lets through while it makes the command job lose its leases. */
const loser = 'probe.losing';
/** How often the end unit of the exhausted job fails before it commits. */
const failures = 4;
/** One lease of a take of the fetcher (30 s) and a little more. */
const pastLeaseMs = 31_000;
const at = (milliseconds: number): Temporal.Instant => workerStart.add({ milliseconds });

const lines: LoggedLine[] = [];
const { runtime, spy } = await startWatched({
  workers: true,
  logger: recordingLogger(lines),
  configure: (watched) => {
    watched.refuseTake = (_queue, worker) => worker !== loser;
  },
});
afterAll(() => runtime.stop());

const receipt = () =>
  runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.receipts.get(commandId),
  );
/** The takes of the runtime's own worker that handed out the exhausted job. */
const endTakes = () =>
  spy.takes.filter((take) => take.worker !== loser && take.jobs.some((job) => job.leasesExhausted));

test('a command job whose end unit fails again and again stays takeable with its receipt accepted, until a unit ends both together', {
  timeout: 60_000,
}, async () => {
  const accepted = await askCloseAll(runtime, commandId);
  expect(accepted.ok).toBe(true);
  // The job loses its lease three times: taken by the test with a lease of one millisecond.
  for (let loss = 0; loss < 3; loss += 1) {
    await runtime.adapter.unit(runtime.namespace, { level: 'namespace', reason: 'test' }, (unit) =>
      unit.jobs.take('commands', loser, {
        limit: 1,
        capabilitySets: [''],
        maxRevision: 1000,
        leaseMs: 1,
      }),
    );
    expect(await runtime.advanceTo(at(10 * (loss + 1)))).toBe(0);
  }
  expect(endTakes()).toEqual([]);
  // From here the end unit of the job fails after it completed the receipt, as a unit of a
  // neighbour does (worker-takeover.test.ts): the unit rolls back, receipt and job with it.
  const cause = errors.conflict('the end unit went down');
  let failed = 0;
  spy.refuseTake = undefined;
  spy.afterReceiptComplete = () => {
    if (failed >= failures) return;
    failed += 1;
    throw cause;
  };
  const completed = spy.completions.length;
  for (let round = 1; round <= failures; round += 1) {
    // At a pinned clock the lease the failed unit left holds: nothing takes the job again.
    await runtime.advanceTo(at(30 + round * pastLeaseMs));
    expect(endTakes().length, `takes after failure ${round}`).toBe(round);
    expect(await runtime.drainJobs()).toBe(0);
    expect(endTakes().length, `takes at the pinned clock after failure ${round}`).toBe(round);
    // Both asserted: the receipt is still accepted and the job is still there to be taken.
    expect((await receipt())?.status).toBe('accepted');
    const stats = await statsOf(runtime, 'commands');
    expect([stats?.due, stats?.running]).toEqual([0, 1]);
    expect(spy.completions.length).toBe(completed);
  }
  expect(failed).toBe(failures);
  const reported = lines.filter(
    (line) => line.message === 'a job whose leases were lost could not be ended',
  );
  expect(reported.map((line) => [line.level, line.fields.cause])).toEqual(
    Array.from({ length: failures }, () => ['warn', cause]),
  );
  // The lease of the last failed unit passes and the next take ends the job with its receipt.
  await runtime.advanceTo(at(30 + (failures + 1) * pastLeaseMs));
  expect(endTakes().length).toBe(failures + 1);
  expect(spy.completions.slice(completed)).toEqual([
    expect.objectContaining({ outcome: expect.objectContaining({ kind: 'dead' }), granted: true }),
  ]);
  expect(await receipt()).toMatchObject({
    status: 'failed',
    outcome: { ok: false, error: { code: 'core.job_lease_lost' } },
  });
  const ended = await statsOf(runtime, 'commands');
  expect([ended?.due, ended?.running]).toEqual([0, 0]);
});
