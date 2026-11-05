import {
  describeTransportConformance,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
import { restCodec } from './support/rest-codec.ts';
import { transportWithRest } from './support/transport-app.ts';

const origins = ['https://app.example.test'];
const config = { rest: { docs: false, cors: origins } };
const options = { app: transportWithRest, host: httpHost(), config };

const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

// The fixture app through REST. The protocol's conformance test runs the same suite through the
// invocation protocol, so together they are slice 3: one scenario set, one decoded outcome.
describe('on the in-memory adapter', () => {
  describeTransportConformance(transportTargetOf(memory, restCodec, origins));
});
describe('on PGlite', () => {
  describeTransportConformance(transportTargetOf(pglite, restCodec, origins));
});
