import type { InfrastructureEntry, LiveTimers } from '@keelwerk/core';
import { pinnedLiveTimers, startTransportRuntime } from '@keelwerk/testing';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { httpHost } from '../src/index.ts';
import { streamApp } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000 });

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

/** The host entry of the stream app, noting the clock and timers the runtime hands it. */
function spying() {
  const seen: { clock?: unknown; timers?: LiveTimers | undefined } = {};
  const entry = httpHost({});
  const host = {
    ...entry,
    create: (deps: Parameters<typeof entry.create>[0]) => {
      seen.clock = deps.clock;
      seen.timers = deps.timers;
      return entry.create(deps);
    },
  } as unknown as InfrastructureEntry;
  return { seen, host };
}

describe('the waits of a live carrier in a runtime', () => {
  test('the timers of the options reach the HTTP host, with the clock they run on', async () => {
    const clock = { now: () => Temporal.Instant.from('2026-11-11T12:00:00Z') };
    const timers = pinnedLiveTimers(clock);
    const { seen, host } = spying();
    const runtime = await startTransportRuntime({ app: streamApp, host, clock, timers });
    stops.push(() => runtime.runtime.stop(1000));
    expect(seen.timers).toBe(timers);
    expect(seen.clock).toBe(clock);
  });

  test('without timers the host gets timers on the runtime clock', async () => {
    const { seen, host } = spying();
    const runtime = await startTransportRuntime({ app: streamApp, host });
    stops.push(() => runtime.runtime.stop(1000));
    expect(typeof seen.timers?.sleepUntil).toBe('function');
    const abort = new AbortController();
    const slept = seen.timers?.sleepUntil(Temporal.Now.instant().add({ hours: 1 }), abort.signal);
    abort.abort();
    expect(await slept).toBe(false);
  });
});
