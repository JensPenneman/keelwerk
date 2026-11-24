import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  pinnedTransportClock,
  protocolCodec,
  startTransportRuntime,
  transportTargetOf,
  waitEffectsCases,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { afterAll, describe } from 'vitest';
import { httpHost } from '../src/index.ts';

const origins = ['https://app.example.test'];
const app = defineApp({ id: 'effects', modules: [live, library, loans] });
const options = {
  app,
  host: httpHost({
    listen: { port: 0 },
    trustedProxies: ['127.0.0.1'],
    liveSocket: { revalidateMs: 10_000_000 },
  }),
};

// The pinned clock of the subscription suite: the case runs on PGlite under it too, because the
// status view of the effect store is the part that differs between the adapters.
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

describe('the effect wait on the in-memory adapter', () => {
  waitEffectsCases(transportTargetOf(memory, protocolCodec, origins, true, memoryClock.advance));
});
describe('the effect wait on PGlite', () => {
  waitEffectsCases(transportTargetOf(pglite, protocolCodec, origins, true, pgliteClock.advance));
});
