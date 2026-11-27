import { afterEach, describe } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { backendApp } from './support/erasure-backend-app.ts';
import { backendCases } from './support/erasure-backend-cases.ts';
import type { Runtime } from './support/erasure-backend-kit.ts';

let stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(stops.map((stop) => stop()));
  stops = [];
});

for (const adapter of ['memory', 'pglite'] as const) {
  describe(`the backend scope of an erasure (14.7.5) on ${adapter}`, () => {
    backendCases(
      {
        start: async ({ worker, sink }) => {
          const runtime: Runtime = await startTestRuntime(backendApp, {
            adapter,
            operators: true,
            workers: true,
            tenants: ['acme', 'globex'],
            eventWorkers: [worker],
            ledgers: [sink],
          });
          stops.push(() => runtime.stop());
          return runtime;
        },
      },
      adapter,
    );
  });
}
