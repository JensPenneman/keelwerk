import {
  describeTransportConformance,
  expectSteppedClockBounds,
  pinnedTransportClock,
  startTransportRuntime,
  steppedClockLiveSocket,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, test } from 'vitest';
import { graphqlCodec } from './support/graphql-codec.ts';
import {
  graphqlConformanceApp,
  graphqlConformanceVersions,
} from './support/graphql-conformance-app.ts';

const origins = ['https://app.example.test'];
const config = { graphql: { cors: origins, websocket: true } };
// A listening host that trusts the loopback: the socket cases open real sockets through it. The bounds of the
// live socket sit far beyond the steps of the pinned clock (see steppedClockLiveSocket).
const host = httpHost({
  listen: { port: 0 },
  trustedProxies: ['127.0.0.1'],
  liveSocket: steppedClockLiveSocket,
});
const options = {
  app: graphqlConformanceApp,
  host,
  config,
  tenants: ['acme', 'globex', 'legacy'],
  tenantApiVersions: { legacy: graphqlConformanceVersions.older },
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

// The fixture app through GraphQL: the one scenario set of the other transports, one decoded outcome.
describe('on the in-memory adapter', () => {
  describeTransportConformance(
    transportTargetOf(memory, graphqlCodec, origins, true, memoryClock.advance),
  );
});
describe('on PGlite', () => {
  describeTransportConformance(
    transportTargetOf(pglite, graphqlCodec, origins, true, pgliteClock.advance),
  );
});
