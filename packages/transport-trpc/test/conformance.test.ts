import {
  describeTransportConformance,
  pinnedTransportClock,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
import { trpcCodec } from './support/trpc-codec.ts';
import { trpcConformanceApp, trpcConformanceVersions } from './support/trpc-conformance-app.ts';

const origins = ['https://app.example.test'];
const config = { trpc: { cors: origins } };
// A listening host that trusts the loopback: the socket cases open real sockets through it.
const host = httpHost({
  listen: { port: 0 },
  trustedProxies: ['127.0.0.1'],
  liveSocket: { revalidateMs: 10_000_000 },
});
const options = {
  app: trpcConformanceApp,
  host,
  config,
  tenants: ['acme', 'globex', 'legacy'],
  tenantApiVersions: { legacy: trpcConformanceVersions.older },
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

// The fixture app through tRPC: the one scenario set of the other transports, one decoded outcome.
describe('on the in-memory adapter', () => {
  describeTransportConformance(
    transportTargetOf(memory, trpcCodec, origins, true, memoryClock.advance),
  );
});
describe('on PGlite', () => {
  describeTransportConformance(
    transportTargetOf(pglite, trpcCodec, origins, true, pgliteClock.advance),
  );
});
