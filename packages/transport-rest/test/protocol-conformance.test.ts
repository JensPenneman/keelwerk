import {
  describeTransportConformance,
  protocolCodec,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
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

// The invocation protocol on a deployment that composes REST with `cors` configured: the REST
// origin is a stranger to `/_keelwerk/v1/*` (S-91), so the browser cases find it refused there.
describe('on the in-memory adapter', () => {
  describeTransportConformance(transportTargetOf(memory, protocolCodec, origins));
});
describe('on PGlite', () => {
  describeTransportConformance(transportTargetOf(pglite, protocolCodec, origins));
});
