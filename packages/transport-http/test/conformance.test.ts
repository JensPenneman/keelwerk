import {
  describeOperatorConformance,
  describeTransportConformance,
  protocolCodec,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { transportApp } from '@keelwerk/testing/fixtures';
import { afterAll, describe } from 'vitest';
import { httpHost } from '../src/index.ts';

const origins = ['https://app.example.test'];
// The protocol app mounts no REST module, so there is no `rest` config to give the backend.
const options = { app: transportApp, host: httpHost() };

const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

// The fixture app through the invocation protocol. The REST conformance test runs the same suite
// through REST, so together they are slice 3: one scenario set, one decoded outcome.
describe('on the in-memory adapter', () => {
  describeTransportConformance(transportTargetOf(memory, protocolCodec, origins));
  describeOperatorConformance(transportTargetOf(memory, protocolCodec, origins));
});
describe('on PGlite', () => {
  describeTransportConformance(transportTargetOf(pglite, protocolCodec, origins));
  describeOperatorConformance(transportTargetOf(pglite, protocolCodec, origins));
});
