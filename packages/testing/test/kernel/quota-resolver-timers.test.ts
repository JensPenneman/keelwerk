import { enqueue, setTimer } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  bootSlice,
  callAs,
  type SliceRuntime,
  setTenantLimit,
  sliceApp,
} from './support/quota-slice-kit.ts';
import { sliceSessionCarrier, withSliceSession } from './support/slice-session-resolver.ts';

// What a principal resolver's timer meets at the queued cap (9.5.5): nothing, it is counted. The
// edge runs before every request of a session, so a refusal there would refuse every request of a
// tenant whose timers queue is full of timers due far ahead, the ones that cancel timers included.
// A command job of a resolver still meets the cap of the commands queue. The resolver is the
// test's own (`slice.session`): it returns the effects its carrier holds, as auth's session
// resolver returns its idle extension. The clock stands still, so a timer due in an hour never
// falls due and no worker runs. What decides each case: the answers of the calls and the number of
// jobs waiting in the queue afterwards, as the job store counts them; nothing else.

const app = withSliceSession(sliceApp);
const timerOf = (key: string) =>
  setTimer({ key, invoke: 'slice.ticker', input: { left: 0 }, after: '1h' });

async function mustSet(runtime: SliceRuntime, dimension: string, limit: string) {
  const set = await setTenantLimit(runtime, runtime.tenants.acme.id, dimension, limit);
  if (!set.ok) throw set.error;
}

const waiting = (runtime: SliceRuntime, queue: string) =>
  runtime.adapter.unit(
    runtime.namespace,
    { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants.acme.id },
    (unit) => unit.jobs.queued(queue, 100),
  );

/** One request of acme's session, whose resolver returns `effects`. */
function throughSession(
  runtime: SliceRuntime,
  effects: Parameters<typeof sliceSessionCarrier>[1],
  action: string,
  input: unknown = {},
) {
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier: sliceSessionCarrier(runtime.tenants.acme, effects),
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

describe('the timer of a resolver is counted at the queued cap and never refused by it', () => {
  test('with the timers queue at its cap, a session opens and gets its timer, its request that cancels a timer succeeds, and a decision is refused at the true count', async () => {
    const runtime = await bootSlice({ app });
    await mustSet(runtime, 'queue:timers.queued', '2');
    // Two timers that a decision set for a far due time fill the queue to its cap.
    expect((await callAs(runtime, 'acme', 'slice.park', { n: 1 })).ok).toBe(true);
    expect((await callAs(runtime, 'acme', 'slice.park', { n: 2 })).ok).toBe(true);
    expect(await waiting(runtime, 'timers')).toBe(2);
    expect(await callAs(runtime, 'acme', 'slice.park', { n: 3 })).toMatchObject({
      ok: false,
      error: { code: 'core.queue_full' },
    });
    expect(await waiting(runtime, 'timers')).toBe(2);
    // A session opens: its resolver's timer is accepted and the count stands above the cap.
    expect(
      (await throughSession(runtime, [timerOf('idle:1')], 'slice.add', { text: 'a' })).ok,
    ).toBe(true);
    expect(await waiting(runtime, 'timers')).toBe(3);
    // The next request of that session sets its timer again (a new key, so a new job) and cancels
    // one of the parked timers in its decision: both go through.
    expect((await throughSession(runtime, [timerOf('idle:2')], 'slice.unpark', { n: 1 })).ok).toBe(
      true,
    );
    expect(await waiting(runtime, 'timers')).toBe(3);
    // A decision's new timer is still refused, at the count that stands.
    expect(await callAs(runtime, 'acme', 'slice.park', { n: 4 })).toMatchObject({
      ok: false,
      error: { code: 'core.queue_full' },
    });
    expect(await waiting(runtime, 'timers')).toBe(3);
  });
});

describe('the command job of a resolver still meets the queued cap of the commands queue', () => {
  test('at the cap the request is refused with core.queue_full and nothing is enqueued', async () => {
    const runtime = await bootSlice({ app });
    await mustSet(runtime, 'queue:commands.queued', '1');
    // One job for later fills the commands queue to its cap.
    expect((await callAs(runtime, 'acme', 'slice.later')).ok).toBe(true);
    expect(await waiting(runtime, 'commands')).toBe(1);
    const asked = await throughSession(runtime, [enqueue('slice.work', {})], 'slice.add', {
      text: 'a',
    });
    expect(asked).toMatchObject({ ok: false, error: { code: 'core.queue_full' } });
    expect(await waiting(runtime, 'commands')).toBe(1);
  });
});
