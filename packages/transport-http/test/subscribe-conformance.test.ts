import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  protocolCodec,
  startTransportRuntime,
  subscriptionCases,
  transportTargetOf,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { afterAll, describe, vi } from 'vitest';
import { httpHost } from '../src/index.ts';

vi.setConfig({ testTimeout: 30_000 });

const origins = ['https://app.example.test'];
// The fixture app with the live module: `loans.loanEvents` exists once live is composed.
const app = defineApp({ id: 'streams', modules: [live, library, loans] });
const options = { app, host: httpHost() };

const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

describe('the subscription cases on the in-memory adapter', () => {
  subscriptionCases(transportTargetOf(memory, protocolCodec, origins, true));
});
describe('the subscription cases on PGlite', () => {
  subscriptionCases(transportTargetOf(pglite, protocolCodec, origins, true));
});
