import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
import { portal } from '../src/app.ts';
import { portalConfig } from './support/portal-config.ts';
import { portalRest } from './support/portal-rest.ts';
import { scenarioCases } from './support/scenario-cases.ts';

const options = { app: portal, host: httpHost(), config: portalConfig };
const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
});

describe('on the in-memory adapter', () => {
  scenarioCases(() => portalRest(memory.fetch, memory.domains.acme ?? ''));
});
describe('on PGlite', () => {
  scenarioCases(() => portalRest(pglite.fetch, pglite.domains.acme ?? ''));
});
