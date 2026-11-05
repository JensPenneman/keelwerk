import { type AppType, defineApiVersions, defineApp, defineTransportModule } from '@keelwerk/core';
import { library, loans } from '@keelwerk/testing/fixtures';

const slow = defineTransportModule({
  id: 'slow',
  transport: {
    name: 'slow',
    capabilities: { streaming: [], batching: false, binary: false },
    static: {},
    check: () => [],
    artifacts: () => [],
    // A transport that waits for its in-flight work: `close` ends only when the deadline aborts.
    mount: async () => ({
      close: (deadline) =>
        new Promise<void>((resolve) => {
          deadline.addEventListener(
            'abort',
            () => {
              slowClosing.settled();
              resolve();
            },
            { once: true },
          );
        }),
    }),
  },
});

const definition = defineApp({
  id: 'slow-closing',
  modules: [library, loans, slow],
  execution: { 'loans.lend': 'either' },
  api: defineApiVersions({ '2026-11-04': {} }),
});

/** The fixture modules with a transport whose mount closes only at the deadline. */
export interface SlowClosingApp extends AppType<typeof definition> {}
export const slowClosingApp: SlowClosingApp = definition;

/** What the slow transport records: when its mount's `close` settled. */
export const slowClosing: { settled: () => void } = { settled: () => undefined };
