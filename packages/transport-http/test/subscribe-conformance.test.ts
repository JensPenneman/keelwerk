import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  expectSteppedClockBounds,
  pinnedTransportClock,
  protocolCodec,
  startTransportRuntime,
  steppedClockLiveSocket,
  subscriptionCases,
  transportTargetOf,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { afterAll, describe, test, vi } from 'vitest';
import { httpHost } from '../src/index.ts';

vi.setConfig({ testTimeout: 30_000 });

const origins = ['https://app.example.test'];
// The fixture app with the live module: `loans.loanEvents` exists once live is composed.
const app = defineApp({ id: 'streams', modules: [live, library, loans] });
const options = {
  app,
  // The bounds of the live socket sit far beyond the steps of the pinned clock (see steppedClockLiveSocket).
  host: httpHost({
    listen: { port: 0 },
    trustedProxies: ['127.0.0.1'],
    liveSocket: steppedClockLiveSocket,
  }),
};

// Each runtime has a pinned clock the cases move: the session check of a running subscription waits a minute of it.
const start = Temporal.Instant.from('2026-11-12T12:00:00Z');
const memoryClock = pinnedTransportClock(start);
const pgliteClock = pinnedTransportClock(start);
const memory = await startTransportRuntime({
  ...options,
  clock: memoryClock.clock,
  timers: memoryClock.timers,
});
const pglite = await startTransportRuntime({
  ...options,
  adapter: 'pglite',
  clock: pgliteClock.clock,
  timers: pgliteClock.timers,
});
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

describe('the live socket bounds of the runner', () => {
  test('sit beyond the longest loop of steps of the pinned clock', () => {
    expectSteppedClockBounds(memory.bounds);
    expectSteppedClockBounds(pglite.bounds);
  });
});

describe('the subscription cases on the in-memory adapter', () => {
  subscriptionCases(transportTargetOf(memory, protocolCodec, origins, true, memoryClock.advance));
});
describe('the subscription cases on PGlite', () => {
  subscriptionCases(transportTargetOf(pglite, protocolCodec, origins, true, pgliteClock.advance));
});
