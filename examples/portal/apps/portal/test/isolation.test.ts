import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe } from 'vitest';
import { portal } from '../src/app.ts';
import { restIsolationCases, storeIsolationCases } from './support/isolation-cases.ts';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { portalConfig } from './support/portal-config.ts';
import { portalRest } from './support/portal-rest.ts';

const options = { app: portal, host: httpHost(), config: portalConfig };
const memory = await startTransportRuntime(options);
const pglite = await startTransportRuntime({ ...options, adapter: 'pglite' });
const stores = {
  memory: await startLocalPortal('memory'),
  pglite: await startLocalPortal('pglite'),
};
afterAll(async () => {
  await memory.stop();
  await pglite.stop();
  await stores.memory.runtime.stop();
  await stores.pglite.runtime.stop();
});

describe.each([
  ['the in-memory adapter', memory, stores.memory],
  ['PGlite', pglite, stores.pglite],
] as const)('isolation on %s', (_name, hosted, local: LocalPortal) => {
  restIsolationCases(
    (name) => portalRest(hosted.fetch, hosted.domains[name] ?? ''),
    () => hosted.tenants,
  );
  storeIsolationCases(() => local);
});
