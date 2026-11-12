import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { startTransportRuntime, subscriptionCases, transportTargetOf } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, vi } from 'vitest';
import { rest } from '../src/index.ts';
import { restCodec } from './support/rest-codec.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const origins = ['https://app.example.test'];
const app = defineApp({ id: 'streams', modules: [live, library, loans, rest] });
const options = { app, host: httpHost(), config: { rest: { docs: false, cors: origins } } };

const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

describe('the subscription cases through REST on the in-memory adapter', () => {
  subscriptionCases(transportTargetOf(memory, restCodec, origins, true));
});
describe('the subscription cases through REST on PGlite', () => {
  subscriptionCases(transportTargetOf(pglite, restCodec, origins, true));
});
