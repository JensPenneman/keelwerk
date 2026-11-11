import {
  describeTransportConformance,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
import { graphqlCodec } from './support/graphql-codec.ts';
import { transportWithGraphql } from './support/transport-app.ts';

const origins = ['https://app.example.test'];
const config = { graphql: { cors: origins } };
const options = { app: transportWithGraphql, host: httpHost(), config };

const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

// The fixture app through GraphQL: the one scenario set of the other transports, one decoded outcome.
describe('on the in-memory adapter', () => {
  describeTransportConformance(transportTargetOf(memory, graphqlCodec, origins));
});
describe('on PGlite', () => {
  describeTransportConformance(transportTargetOf(pglite, graphqlCodec, origins));
});
