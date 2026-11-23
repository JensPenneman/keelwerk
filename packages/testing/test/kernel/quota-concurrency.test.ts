import { describe, expect, onTestFinished, test } from 'vitest';
import { pinnedLiveTimers } from '../../src/harness/pinned-live-timers.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { concurrencyApp } from './support/concurrency-app.ts';
import { barrier, callFlow, type FlowRuntime, openNotes } from './support/concurrency-kit.ts';
import { movableClock } from './support/movable-clock.ts';
import { bootSlice, callAs, setFreshLimit } from './support/quota-slice-kit.ts';
import { sweptMemoryStore } from './support/swept-store.ts';

// What a tenant's limits of invocations in flight and of open subscriptions do to its requests while
// the other tenant carries on, on the in-memory adapter. A command is kept in flight at the enqueue
// of its unit (the adapter runs the writing units of a namespace one at a time, tenants of one
// placement together, so one command is held at a time and no other tenant can write meanwhile; the
// PostgreSQL twin holds one at a time per process and lets the other tenant run), a stream is kept
// open by not closing it; nothing here waits for a time to pass.

const refusal = {
  ok: false,
  error: { kind: 'rate_limited', code: 'core.concurrency_limited', retryAfter: 1 },
} as const;

describe('the invocations in flight of a tenant', () => {
  test('past the limit the next is refused with retryAfter, and one is admitted again when it ends, while the other tenant carries on', async () => {
    const gate = barrier();
    // The setting of the limit enqueues the hooks of the tenant: the barrier holds only once it is armed.
    let armed: string | undefined;
    const runtime = await bootSlice({
      hold: (tenant) => (tenant === armed ? gate.pass() : Promise.resolve()),
    });
    const acme = runtime.tenants.acme.id;
    const set = await setFreshLimit(runtime, acme, 'core.concurrentInvocations', '1');
    expect(set.ok).toBe(true);
    // A call before the barrier makes the process hold tokens of the rate buckets, so a call behind
    // the held unit needs no unit of its own to pass the rate check.
    expect((await callAs(runtime, 'acme', 'slice.add', { text: 'warm' })).ok).toBe(true);
    armed = acme;
    const running = callAs(runtime, 'acme', 'slice.later');
    await gate.arrived(1);
    const second = await callAs(runtime, 'acme', 'slice.add', { text: 'two' });
    expect(second).toMatchObject(refusal);
    expect(second.ok ? undefined : second.error.details).toEqual({
      dimension: 'core.concurrentInvocations',
      limit: 1,
    });
    gate.open();
    expect((await running).ok).toBe(true);
    expect((await callAs(runtime, 'globex', 'slice.add', { text: 'g' })).ok).toBe(true);
    expect((await callAs(runtime, 'acme', 'slice.add', { text: 'three' })).ok).toBe(true);
    expect((await callAs(runtime, 'acme', 'slice.later')).ok).toBe(true);
  });
});

describe('the subscriptions of a tenant', () => {
  /**
   * The flow app on a clock the case moves, with the keeper of the leases on pinned timers: `pass`
   * moves the clock, fires the keeper and answers once its pass has swept and committed.
   */
  async function bootFlow() {
    const moving = movableClock('2026-11-23T08:00:00Z');
    const timers = pinnedLiveTimers(moving.clock);
    let swept = Promise.withResolvers<void>();
    const started = await startTestRuntime(concurrencyApp, {
      operators: true,
      tenants: ['acme', 'globex'],
      clock: moving.clock,
      timers,
      external: {
        factory: sweptMemoryStore({
          registry: concurrencyApp.registry,
          clock: moving.clock,
          swept: () => {
            swept.resolve();
            swept = Promise.withResolvers<void>();
          },
        }),
        url: `memory://quota-concurrency-${crypto.randomUUID()}`,
      },
    });
    const runtime = Object.assign(started, { step: moving.step });
    onTestFinished(() => runtime.stop());
    const limit = (value: string) =>
      setFreshLimit(runtime, runtime.tenants.acme.id, 'core.liveSubscriptions', value);
    const pass = async (ms: number) => {
      const done = swept.promise;
      moving.step(ms);
      await timers.fire();
      await done;
      // What follows the commit of the sweep is microtasks only: the keeper sets its next wait
      // before this turn of the event loop ends.
      await new Promise<void>((resolve) => setImmediate(resolve));
    };
    return { runtime, limit, pass };
  }

  test('past the limit the next is refused while the other tenant carries on, and one is admitted again when a stream is closed', async () => {
    const { runtime, limit } = await bootFlow();
    expect((await limit('2')).ok).toBe(true);
    const first = await openNotes(runtime, 'acme');
    const second = await openNotes(runtime, 'acme');
    expect(first).toHaveProperty('close');
    expect(second).toHaveProperty('close');
    expect(await openNotes(runtime, 'acme')).toMatchObject({
      error: {
        kind: 'rate_limited',
        code: 'core.concurrency_limited',
        retryAfter: 1,
        details: { dimension: 'core.liveSubscriptions', limit: 2 },
      },
    });
    expect(await openNotes(runtime, 'globex')).toHaveProperty('close');
    if ('close' in first) first.close();
    expect(await openNotes(runtime, 'acme')).toHaveProperty('close');
  });

  test('a setup that fails after admit gives its slot back', async () => {
    const { runtime, limit } = await bootFlow();
    expect((await limit('1')).ok).toBe(true);
    expect(await openNotes(runtime, 'acme', { page: 'not a number' })).toMatchObject({
      error: { kind: 'validation' },
    });
    expect(await openNotes(runtime, 'acme')).toHaveProperty('close');
  });

  /** The stream the tenant opens; a refusal fails the case. */
  async function opened(runtime: FlowRuntime, tenant: 'acme' | 'globex') {
    const stream = await openNotes(runtime, tenant);
    if ('error' in stream) throw stream.error;
    return stream;
  }

  test('a lowered limit closes nothing: the take within the slots the process holds is admitted until its pass, the next one is refused after it, and one is admitted again once enough has ended, while the other tenant carries on', async () => {
    const { runtime, limit, pass } = await bootFlow();
    expect((await limit('3')).ok).toBe(true);
    // The other tenant keeps one stream open from here to the end: it counts in its own pair and in no other.
    const bystander = await opened(runtime, 'globex');
    const first = await opened(runtime, 'acme');
    const second = await opened(runtime, 'acme');
    const third = await opened(runtime, 'acme');
    expect((await limit('1')).ok).toBe(true);
    // Three are open under a limit of one, and all three still receive what happens in the tenant.
    expect((await callFlow(runtime, 'acme', 'flow.add', { text: 'one' })).ok).toBe(true);
    for (const stream of [first, second, third]) expect(await stream.next()).toBeDefined();
    first.close();
    second.close();
    // The process holds the slots of the two that ended until its next pass: one more is admitted.
    const fourth = await opened(runtime, 'acme');
    await pass(10_000);
    const refused = await openNotes(runtime, 'acme');
    expect(refused).toMatchObject({
      error: {
        kind: 'rate_limited',
        code: 'core.concurrency_limited',
        retryAfter: 1,
        details: { dimension: 'core.liveSubscriptions', limit: 1 },
      },
    });
    // The pass gave up the slots that were not in use and closed nothing.
    expect((await callFlow(runtime, 'acme', 'flow.add', { text: 'two' })).ok).toBe(true);
    for (const stream of [third, fourth]) expect(await stream.next()).toBeDefined();
    // One more ends and the count stands at the limit: still refused. When the last has ended, admitted.
    third.close();
    await pass(10_000);
    expect(await openNotes(runtime, 'acme')).toHaveProperty('error');
    fourth.close();
    await pass(10_000);
    // Admitted while the other tenant's stream is open, and that stream has received what happened to its tenant.
    expect(await openNotes(runtime, 'acme')).toHaveProperty('close');
    expect((await callFlow(runtime, 'globex', 'flow.add', { text: 'three' })).ok).toBe(true);
    expect(await bystander.next()).toBeDefined();
  });
});
