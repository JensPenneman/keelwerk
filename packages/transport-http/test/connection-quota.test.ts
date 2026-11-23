import { targetingRefreshMs } from '@keelwerk/core';
import { freshName, originOf, pinnedTransportClock, requestHeaders } from '@keelwerk/testing';
import { afterEach, describe, expect, test } from 'vitest';
import { type StreamRuntime, startStreamRuntime } from './support/stream-runtime.ts';

// A stream is counted twice: against the bounds of the host, which are per process, and against
// the tenant's `core.liveConnections`, which are across the deployment. Each refusal keeps its own
// code, and a stream the host refuses holds nothing across the deployment. Every stream stays open
// for the whole case, so nothing here waits for a stream to end. The clock stands still except for the
// step past the refresh bound of the quota cache after the start: the start writes the limit and the
// cache reads it when its feed wakes or when its rows are older than that bound, so the first request
// reads it whichever of the two comes first, and no time has to pass.

const running: StreamRuntime[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  await Promise.all(running.splice(0).map((started) => started.runtime.stop()));
});

async function started(connections: string, live: Parameters<typeof startStreamRuntime>[0]) {
  const pinned = pinnedTransportClock(Temporal.Instant.from('2026-11-23T08:00:00Z'));
  const made = await startStreamRuntime(live, {
    clock: pinned.clock,
    timers: pinned.timers,
    config: { core: { quotas: { 'core.liveConnections': connections } } },
  });
  running.push(made);
  await pinned.advance(targetingRefreshMs + 1);
  const open = async (subject: string) => {
    const response = await made.target.fetch(
      new Request(`${originOf(made.target, {})}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: requestHeaders({ subject }),
      }),
    );
    // A refusal is read to its end by the case; an open stream is cancelled at the end of it.
    closers.push(async () => {
      if (response.body !== null && !response.body.locked) await response.body.cancel();
    });
    return response;
  };
  return { open };
}

describe('the connections of a tenant across the deployment', () => {
  test('past core.liveConnections a stream is refused with core.concurrency_limited, and the stream the host counted for it is given back', async () => {
    const { open } = await started('1', { live: { maxStreamsPerTenant: 2 } });
    const first = await open(freshName('ada'));
    expect(first.status).toBe(200);
    const second = await open(freshName('bob'));
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('1');
    expect(await second.json()).toMatchObject({
      error: { code: 'core.concurrency_limited' },
    });
    // The host's bound of two for the tenant is not used up by the refused stream.
    const third = await open(freshName('carol'));
    expect(await third.json()).toMatchObject({
      error: { code: 'core.concurrency_limited' },
    });
  });

  test('a stream the host refuses holds no slot of the deployment, and its refusal keeps core.quota_exceeded', async () => {
    const { open } = await started('2', { live: { maxStreamsPerPrincipal: 1 } });
    const ada = freshName('ada');
    expect((await open(ada)).status).toBe(200);
    const refused = await open(ada);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      error: { code: 'core.quota_exceeded', message: 'Too many streams are open.' },
    });
    // One slot of two is still free for another principal; then the deployment count is full.
    expect((await open(freshName('bob'))).status).toBe(200);
    const full = await open(freshName('carol'));
    expect(await full.json()).toMatchObject({
      error: { code: 'core.concurrency_limited' },
    });
  });

  test('when both bounds refuse at once, the host answers first: core.quota_exceeded', async () => {
    // Take `host.limits.take` after `holdConnection` in take-stream-slot.ts: this refusal is core.concurrency_limited.
    const { open } = await started('1', { live: { maxStreamsPerPrincipal: 1 } });
    const ada = freshName('ada');
    expect((await open(ada)).status).toBe(200);
    const refused = await open(ada);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: 'core.quota_exceeded' } });
  });
});
