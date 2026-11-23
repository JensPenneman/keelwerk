import { describe, expect, test } from 'vitest';
import type { SliceRuntime, StoreOp } from './support/quota-slice-kit.ts';
import { bootSlice, callAs, setFreshLimit } from './support/quota-slice-kit.ts';

// SLICE M2-8 on the in-memory adapter, two tenants, the clock pinned: what the limits of a tenant do
// to its requests, its writes and its jobs while the other tenant carries on. What decides each
// case: the answers of the calls, the rows and jobs the store holds, and counts of what the job
// store did, in the order it did it; no case waits for a time to pass, because the clock stands
// still (a rate bucket does not refill, a job for later never falls due) except for the second
// after each limit that is set, which the quota cache needs to read the rows again.

const namespaceScope = { level: 'namespace', reason: 'test' } as const;

async function mustSet(runtime: SliceRuntime, tenant: 'acme' | 'globex', dim: string, v: string) {
  const set = await setFreshLimit(runtime, runtime.tenants[tenant].id, dim, v);
  if (!set.ok) throw set.error;
}

const scopeOf = (runtime: SliceRuntime, tenant: 'acme' | 'globex') =>
  ({
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants[tenant].id,
  }) as const;

/** The jobs waiting in `commands` for the tenant, as the store counts them. */
const queued = (runtime: SliceRuntime, tenant: 'acme' | 'globex', queue = 'commands') =>
  runtime.adapter.unit(runtime.namespace, scopeOf(runtime, tenant), (unit) =>
    unit.jobs.queued(queue, 100),
  );

/** One take as a worker makes it: the jobs it hands out by tenant. */
async function takeByTenant(runtime: SliceRuntime, limit: number) {
  const taken = await runtime.adapter.unit(runtime.namespace, namespaceScope, (unit) =>
    unit.jobs.take('commands', 'w1', {
      limit,
      capabilitySets: [''],
      maxRevision: 100,
      leaseMs: 60_000,
    }),
  );
  const count = (tenant: 'acme' | 'globex') =>
    taken.jobs.filter(
      (job) => job.scope.level === 'tenant' && job.scope.tenantId === runtime.tenants[tenant].id,
    ).length;
  return { acme: count('acme'), globex: count('globex') };
}

describe('what a tenant over a limit meets while the other tenant carries on', () => {
  test('over its request rate: rate_limited with retryAfter, and its jobs and the other tenant are not held', async () => {
    const runtime = await bootSlice();
    await mustSet(runtime, 'acme', 'core.requestRate', '2/1h');
    expect((await callAs(runtime, 'acme', 'slice.add', { text: 'one' })).ok).toBe(true);
    expect((await callAs(runtime, 'acme', 'slice.add', { text: 'two' })).ok).toBe(true);
    const refused = await callAs(runtime, 'acme', 'slice.add', { text: 'three' });
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', code: 'core.rate_limited' },
    });
    expect((refused.ok ? 0 : refused.error.retryAfter) ?? 0).toBeGreaterThan(0);
    for (const text of ['a', 'b', 'c', 'd']) {
      expect((await callAs(runtime, 'globex', 'slice.add', { text })).ok).toBe(true);
    }
  });

  test('over its storage quota: core.quota_exceeded and nothing written, while the other tenant writes', async () => {
    const runtime = await bootSlice();
    await mustSet(runtime, 'acme', 'core.rows', '1');
    expect((await callAs(runtime, 'acme', 'slice.add', { text: 'one' })).ok).toBe(true);
    expect(await callAs(runtime, 'acme', 'slice.add', { text: 'two' })).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', code: 'core.quota_exceeded' },
    });
    for (const text of ['a', 'b', 'c']) {
      expect((await callAs(runtime, 'globex', 'slice.add', { text })).ok).toBe(true);
    }
  });

  test('over its queued cap: core.queue_full with retryAfter, a job for later counted, while the other tenant is accepted', async () => {
    const runtime = await bootSlice();
    await mustSet(runtime, 'acme', 'queue:commands.queued', '2');
    expect(await callAs(runtime, 'acme', 'slice.work', {}, 'async')).toMatchObject({
      ok: true,
      receipt: { status: 'accepted' },
    });
    // A job for later waits in the queue and counts against the cap all the same.
    expect((await callAs(runtime, 'acme', 'slice.later')).ok).toBe(true);
    expect(await queued(runtime, 'acme')).toBe(2);
    expect(await callAs(runtime, 'acme', 'slice.work', {}, 'async')).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', code: 'core.queue_full' },
    });
    expect(await queued(runtime, 'acme')).toBe(2);
    for (let n = 0; n < 3; n += 1) {
      expect(await callAs(runtime, 'globex', 'slice.work', {}, 'async')).toMatchObject({
        ok: true,
        receipt: { status: 'accepted' },
      });
    }
    expect(await queued(runtime, 'globex')).toBe(3);
  });

  test('a job of a tenant over its request rate still runs: a job takes no token of the rate', async () => {
    const runtime = await bootSlice({ workers: true });
    await mustSet(runtime, 'acme', 'core.requestRate', '1/1h');
    const accepted = await callAs(runtime, 'acme', 'slice.work', {}, 'async');
    expect(accepted).toMatchObject({ ok: true, receipt: { status: 'accepted' } });
    // The one token is spent: the next request is refused, and nothing refills it.
    expect(await callAs(runtime, 'acme', 'slice.add', { text: 'one' })).toMatchObject({
      ok: false,
      error: { code: 'core.rate_limited' },
    });
    expect(await runtime.drainJobs()).toBe(1);
    const commandId = accepted.ok ? accepted.receipt?.commandId : undefined;
    const receipt = await runtime.adapter.unit(
      runtime.namespace,
      scopeOf(runtime, 'acme'),
      (unit) => unit.receipts.get(String(commandId)),
    );
    expect(receipt?.status).toBe('completed');
    expect(await callAs(runtime, 'acme', 'slice.add', { text: 'two' })).toMatchObject({
      ok: false,
      error: { code: 'core.rate_limited' },
    });
  });
});

describe('a limit set in config.core.quotas reaches a decision through the runtime cache', () => {
  test('the backend value is the cap its tenants meet, and that many jobs run at once', async () => {
    const runtime = await bootSlice({
      config: {
        core: { quotas: { 'queue:commands.queued': '3', 'queue:commands.running': '2' } },
      },
    });
    for (let n = 0; n < 3; n += 1) {
      expect((await callAs(runtime, 'acme', 'slice.work', {}, 'async')).ok).toBe(true);
    }
    expect(await callAs(runtime, 'acme', 'slice.work', {}, 'async')).toMatchObject({
      ok: false,
      error: { code: 'core.queue_full' },
    });
    expect(await queued(runtime, 'acme')).toBe(3);
    // Three jobs are ready and the lane runs two at once: a take hands out two.
    expect(await takeByTenant(runtime, 10)).toEqual({ acme: 2, globex: 0 });
  });

  test('the lanes of two tenants take their weights from the limits: what one take hands out is split by them', async () => {
    const runtime = await bootSlice({
      config: {
        core: {
          quotas: {
            'queue:commands.queued': '20',
            'queue:commands.running': '20',
            'queue:commands.weight': '3',
          },
        },
      },
    });
    await mustSet(runtime, 'globex', 'queue:commands.weight', '1');
    for (const tenant of ['acme', 'globex'] as const) {
      for (let n = 0; n < 8; n += 1) await callAs(runtime, tenant, 'slice.work', {}, 'async');
    }
    // The weights are 3 and 1: of the first eight jobs, one take for each, the lane of acme gets six.
    let acme = 0;
    let globex = 0;
    for (let n = 0; n < 8; n += 1) {
      const one = await takeByTenant(runtime, 1);
      acme += one.acme;
      globex += one.globex;
    }
    expect({ acme, globex }).toEqual({ acme: 6, globex: 2 });
  });
});

/** What a log of the job store says about one tenant's jobs in one queue, as the store saw them in order. */
function countsOf(log: readonly StoreOp[], tenant: string, queue: string) {
  let waiting = 0;
  let running = 0;
  let mostWaiting = 0;
  let mostRunning = 0;
  let completed = 0;
  for (const entry of log) {
    if (entry.tenant !== tenant || entry.queue !== queue) continue;
    if (entry.op === 'enqueue') waiting += 1;
    if (entry.op === 'take') {
      waiting -= 1;
      running += 1;
    }
    if (entry.op === 'complete') {
      running -= 1;
      completed += 1;
    }
    mostWaiting = Math.max(mostWaiting, waiting);
    mostRunning = Math.max(mostRunning, running);
  }
  return { mostWaiting, mostRunning, completed };
}

describe('a command that enqueues itself', () => {
  test('the queue does not grow, the lane running cap bounds it, and the other tenant is served', async () => {
    const log: StoreOp[] = [];
    const runtime = await bootSlice({ log, workers: { queues: ['commands'], slots: 8 } });
    await mustSet(runtime, 'acme', 'queue:commands.running', '2');
    // Three loops of four runs each for both tenants, started in one decision each.
    await callAs(runtime, 'acme', 'slice.spawn', { count: 3, left: 3 });
    await callAs(runtime, 'globex', 'slice.spawn', { count: 3, left: 3 });
    await runtime.drainJobs();
    const acme = countsOf(log, runtime.tenants.acme.id, 'commands');
    const globex = countsOf(log, runtime.tenants.globex.id, 'commands');
    // Each run takes one job and enqueues the next: at most the three that were started wait.
    expect(acme.mostWaiting).toBe(3);
    // Three jobs are ready and the lane's running cap is two.
    expect(acme.mostRunning).toBe(2);
    expect(acme.completed).toBe(12);
    // The other tenant runs all its jobs, under its own cap of four, while acme loops.
    expect(globex.completed).toBe(12);
    expect(globex.mostWaiting).toBe(3);
    expect(globex.mostRunning).toBeLessThanOrEqual(4);
    // Neither is held back for the other: the lane of globex is taken while acme still has jobs
    // waiting, and the lane of acme is taken while globex has some. The order is the store log's.
    const takes = log.filter((entry) => entry.op === 'take' && entry.queue === 'commands');
    const firstOf = (tenant: string) => takes.findIndex((entry) => entry.tenant === tenant);
    const lastOf = (tenant: string) => takes.findLastIndex((entry) => entry.tenant === tenant);
    const [acmeId, globexId] = [runtime.tenants.acme.id, runtime.tenants.globex.id];
    expect(firstOf(globexId)).toBeGreaterThanOrEqual(0);
    expect(firstOf(globexId)).toBeLessThan(lastOf(acmeId));
    expect(firstOf(acmeId)).toBeLessThan(lastOf(globexId));
  });

  test('a timer loop holds one waiting timer at a time and ends', async () => {
    const log: StoreOp[] = [];
    const runtime = await bootSlice({ log, workers: { queues: ['commands', 'timers'] } });
    expect(await callAs(runtime, 'acme', 'slice.ticker', { left: 5 }, 'async')).toMatchObject({
      ok: true,
    });
    // A timer due now that a run sets is left to the next drain: the chain is finite, so this ends.
    while ((await runtime.drainJobs()) > 0);
    const timers = countsOf(log, runtime.tenants.acme.id, 'timers');
    expect(timers.mostWaiting).toBe(1);
    expect(timers.completed).toBe(5);
    expect(await queued(runtime, 'acme', 'timers')).toBe(0);
  });
});
