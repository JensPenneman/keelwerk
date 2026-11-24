import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { startTransportRuntime, transportTargetOf, waitEffectsCases } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
import { rest } from '../src/index.ts';
import { restCodec } from './support/rest-codec.ts';

const origins = ['https://app.example.test'];
const app = defineApp({ id: 'effects', modules: [live, library, loans, rest] });
const options = { app, host: httpHost(), config: { rest: { docs: false, cors: origins } } };

const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

describe('the effect wait through REST on the in-memory adapter', () => {
  waitEffectsCases(transportTargetOf(memory, restCodec, origins, true));
});
describe('the effect wait through REST on PGlite', () => {
  waitEffectsCases(transportTargetOf(pglite, restCodec, origins, true));
});
