import {
  describeTransportConformance,
  expectSteppedClockBounds,
  pinnedTransportClock,
  startTransportRuntime,
  steppedClockLiveSocket,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, test, vi } from 'vitest';
import { orpcCodec } from './support/orpc-codec.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const origins = ['https://app.example.test'];
const options = {
  app: orpcConformanceApp,
  // A listening host that trusts the loopback: the socket cases open real sockets through it.
  host: httpHost({
    listen: { port: 0 },
    trustedProxies: ['127.0.0.1'],
    // The bounds sit far beyond the steps of the pinned clock (see steppedClockLiveSocket).
    liveSocket: steppedClockLiveSocket,
  }),
  config: { orpc: { cors: origins } },
  tenants: ['acme', 'globex', 'legacy'],
  tenantApiVersions: { legacy: orpcConformanceVersions.older },
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

// The fixture app through oRPC: the one scenario set of the other transports, one decoded outcome.
// The selection cases are skipped: oRPC returns the shapes actions declare and follows no relations (S-174).
describe('on the in-memory adapter', () => {
  describeTransportConformance(
    transportTargetOf(memory, orpcCodec, origins, true, memoryClock.advance),
  );
});
describe('on PGlite', () => {
  describeTransportConformance(
    transportTargetOf(pglite, orpcCodec, origins, true, pgliteClock.advance),
  );
});
describe('the live socket bounds of the runner', () => {
  test('sit beyond the longest loop of steps of the pinned clock', () => {
    expectSteppedClockBounds(memory.bounds);
    expectSteppedClockBounds(pglite.bounds);
  });
});
