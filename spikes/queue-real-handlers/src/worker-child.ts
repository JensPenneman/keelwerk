import { createInterface } from 'node:readline';
import { testCarrier, testPrincipal } from '@keelwerk/testing';
import type { ChildConfig } from './child-config.ts';
import { tenantNames } from './kinds.ts';
import { startBenchRuntime } from './start-bench-runtime.ts';

// A child process of the measurement: argv[2] is a JSON `ChildConfig`. It writes `ready` once it has
// joined, and stops its runtime when its input ends.
const config = JSON.parse(process.argv[2] ?? '') as ChildConfig;
const { mode } = config;
const { runtime } = await startBenchRuntime(config.urls, {
  reactions: config.reactions,
  join: config,
  ...(mode.kind === 'work' ? { workers: { queues: [mode.queue], slots: mode.slots } } : {}),
});
const lines = createInterface({ input: process.stdin });
const input = (async () => {
  for await (const line of lines) {
    if (line === 'go' && mode.kind === 'calls') {
      const each = Math.ceil(mode.calls / tenantNames.length);
      await Promise.all(
        tenantNames.map(async (name) => {
          const tenant = runtime.tenants[name];
          for (let call = 0; call < each; call += 1) {
            const outcome = await runtime.invoker.invoke({
              action: 'bench.record',
              input: { label: 'calibration' },
              carrier: testCarrier(tenant, testPrincipal(null)),
              requestId: crypto.randomUUID(),
              commandId: crypto.randomUUID(),
              signal: new AbortController().signal,
            });
            if (!outcome.ok) throw outcome.error;
          }
        }),
      );
      process.stdout.write('done\n');
    }
  }
})();
process.stdout.write('ready\n');
await input;
await runtime.stop();
