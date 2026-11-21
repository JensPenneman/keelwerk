import { errors, reactionQueue } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { erasedShelfApp } from './support/erased-shelf-app.ts';
import { drainHooks, effectOf } from './support/hooks-reads.ts';
import {
  expectCountedAbove,
  putOverTheLimits,
  readStore,
  watchQuotaLoads,
} from './support/over-the-limit.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { watchedHooks } from './support/watched-hooks.ts';
import {
  acmeScope,
  askCloseAll,
  enqueueAll,
  jobSpecOf,
  ownQueue,
  startWatched,
  statsOf,
  workerStart,
} from './support/worker-kit.ts';

// The tenant's counters stand above their limits, put there as in production: commands store
// records, then `core.quota.set` lowers the limits of the tenant below the counters (see
// support/over-the-limit.ts). A unit the framework runs for itself declares no limit: it commits,
// and what it stores is counted. What decides each case: the committed store after the awaited
// calls and the drain of the runtime's jobs; nothing in the background changes a counter after them.

/** A caller's command of the conformance app that stores records: a loan of a book of its own title. */
function lendsBooks(runtime: Awaited<ReturnType<typeof startWatched>>['runtime']) {
  let titles = 0;
  return () => {
    titles += 1;
    return runtime.invoker.invoke({
      action: 'loans.lend',
      input: {
        bookTitle: `Title ${titles}`,
        dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
      },
      carrier: testCarrier(runtime.tenants.acme, { subject: 'bea', roles: [], claims: {} }),
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  };
}

test('a worker settles an external effect', async () => {
  const cleanup: (() => Promise<void>)[] = [];
  const loads = watchQuotaLoads();
  const booted = await watchedHooks(
    Temporal.Instant.from('2026-03-01T08:00:00Z'),
    cleanup,
    undefined,
    { operators: true, logger: loads.logger },
  );
  try {
    // The posts worker takes nothing until the test has read the store, so no settle can move the
    // counter before `before` is read, however slow a step of the test is.
    booted.spy.refuseTake = (queue) => queue === 'posts';
    const grow = () => booted.client.attempt('hooks.notify', { payload: 'grow' });
    expect((await grow()).ok).toBe(true);
    expect((await effectOf(booted, 'hooks.post'))?.status).toBe('requested');
    const over = { runtime: booted.runtime, scope: booted.scope, loads, grow };
    await putOverTheLimits(over);
    const before = await readStore(over);
    expect((await effectOf(booted, 'hooks.post'))?.status).toBe('requested');
    booted.spy.refuseTake = undefined;
    await drainHooks(booted);
    expect((await effectOf(booted, 'hooks.post'))?.status).toBe('succeeded');
    expect(await expectCountedAbove(over, before)).toBeGreaterThan(0n);
  } finally {
    await Promise.allSettled(cleanup.map((close) => close()));
  }
});

test('the end of an exhausted command job commits its receipt', { timeout: 60_000 }, async () => {
  const commandId = '00000000-0000-7000-8000-000000000172';
  const loser = 'probe.losing';
  const loads = watchQuotaLoads();
  const { runtime, spy } = await startWatched({
    logger: loads.logger,
    workers: true,
    configure: (watched) => {
      watched.refuseTake = (_queue, worker) => worker !== loser;
    },
  });
  try {
    const grow = lendsBooks(runtime);
    expect((await grow()).ok).toBe(true);
    expect((await askCloseAll(runtime, commandId)).ok).toBe(true);
    // The job loses its lease three times: taken by the test with a lease of one millisecond.
    for (let loss = 1; loss <= 3; loss += 1) {
      await runtime.adapter.unit(
        runtime.namespace,
        { level: 'namespace', reason: 'test' },
        (unit) =>
          unit.jobs.take('commands', loser, {
            limit: 1,
            capabilitySets: [''],
            maxRevision: 1000,
            leaseMs: 1,
          }),
      );
      expect(await runtime.advanceTo(workerStart.add({ milliseconds: 10 * loss }))).toBe(0);
    }
    const over = { runtime, scope: acmeScope(runtime), loads, grow };
    await putOverTheLimits(over);
    const before = await readStore(over);
    spy.refuseTake = undefined;
    await runtime.advanceTo(workerStart.add({ minutes: 2 }));
    const receipt = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
      unit.receipts.get(commandId),
    );
    expect(receipt).toMatchObject({
      status: 'failed',
      outcome: { ok: false, error: { code: 'core.job_lease_lost' } },
    });
    const ended = await statsOf(runtime, 'commands');
    expect([ended?.due, ended?.running]).toEqual([0, 0]);
    // The change record of the receipt is the one the framework removes itself: nothing counted.
    expect(await expectCountedAbove(over, before)).toBe(0n);
  } finally {
    await runtime.stop();
  }
});

test('a release at a drain gives the job back', { timeout: 60_000 }, async () => {
  const loads = watchQuotaLoads();
  const { runtime, spy } = await startWatched({ logger: loads.logger });
  try {
    const grow = lendsBooks(runtime);
    expect((await grow()).ok).toBe(true);
    const over = { runtime, scope: acmeScope(runtime), loads, grow };
    await putOverTheLimits(over);
    const before = await readStore(over);
    const queue = ownQueue(runtime);
    const started = Promise.withResolvers<void>();
    const handle = await queue.work(
      'stuck',
      () => {
        started.resolve();
        return new Promise<void>(() => undefined);
      },
      { slots: 1, capabilitySets: [''], revision: 1 },
    );
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'stuck' })]);
    queue.probe.wake();
    await started.promise;
    expect(await handle.drain(Temporal.Now.instant())).toBe(1);
    expect(spy.releases.map((entry) => entry.released.length)).toEqual([1]);
    const stats = await statsOf(runtime, 'stuck');
    expect([stats?.due, stats?.running]).toEqual([1, 0]);
    expect(await expectCountedAbove(over, before)).toBe(0n);
  } finally {
    await runtime.stop();
  }
});

test('an erasure step stores its record', { timeout: 60_000 }, async () => {
  const worker = erasure({ pollMs: 3_600_000 });
  const loads = watchQuotaLoads();
  const runtime = await startTestRuntime(erasedShelfApp, {
    logger: loads.logger,
    adapter: 'memory',
    operators: true,
    workers: true,
    eventWorkers: [worker],
  });
  try {
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const [ada, bea] = [crypto.randomUUID(), crypto.randomUUID()];
    const put = (ownerId: string) =>
      operator.attempt('shelf.put', { ownerId: ownerId as never, title: 'note', secret: 'secret' });
    expect((await put(ada)).ok).toBe(true);
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const over = { runtime, scope, loads, grow: () => put(bea) };
    await putOverTheLimits(over);
    const before = await readStore(over);
    const erased = (records: Awaited<ReturnType<typeof readStore>>) =>
      records.events.some(
        (event) =>
          event.type.endsWith('.erased') &&
          (event.data as { readonly subjectId?: string } | null)?.subjectId === ada,
      );
    expect(erased(before)).toBe(false);
    // `core.eraseSubject` is a core action: it declares no limit, and neither does the worker's pass.
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    expect(erased(await readStore(over))).toBe(false);
    await worker.pass();
    expect(erased(await readStore(over))).toBe(true);
    expect(await expectCountedAbove(over, before)).toBeGreaterThan(0n);
  } finally {
    await runtime.stop();
  }
});

test('a dispatcher pass enqueues the jobs of the reactions', { timeout: 60_000 }, async () => {
  // Until the test opens the gate the dispatcher's batches fail and roll back, so the event of the
  // first command is dispatched by the pass the test asks for, with the counters over the limits.
  // No worker serves a queue, so no job runs: the pass is the only unit that moves.
  let open = false;
  const loads = watchQuotaLoads();
  const kit = await bootReactions({
    logger: loads.logger,
    adapter: 'memory',
    operators: true,
    workers: { queues: ['unserved'] },
    wrap: (spec) => ({
      ...spec,
      consume: async (events, unit) => {
        if (!open) throw errors.unavailable('the dispatcher is held by the test');
        return spec.consume(events, unit);
      },
    }),
  });
  try {
    const grow = () => kit.send('acme', { channel: 'p', contact: 'ada@example.com' });
    expect((await grow()).ok).toBe(true);
    const over = { runtime: kit.runtime, scope: kit.scopeOf('acme'), loads, grow };
    await putOverTheLimits(over);
    const before = await readStore(over);
    const due = async () =>
      (
        await kit.runtime.adapter.unit(
          kit.runtime.namespace,
          { level: 'namespace', reason: 'test' },
          (unit) => unit.jobs.stats(reactionQueue),
        )
      ).reduce((sum, stats) => sum + stats.due, 0);
    expect(await due()).toBe(0);
    open = true;
    // The runner holds a scope that asked for time for one second of the pinned clock.
    kit.pin(kit.now().add({ seconds: 2 }));
    expect(await kit.dispatcher.settled()).toBeGreaterThan(0);
    expect(await due()).toBeGreaterThan(0);
    expect(await expectCountedAbove(over, before)).toBe(0n);
  } finally {
    await kit.stop();
  }
});
