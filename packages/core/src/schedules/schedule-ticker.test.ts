import { test, vi } from 'vitest';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import { createScheduleTicker } from './schedule-ticker.ts';

vi.mock('../worker/framework-ready.ts', () => ({
  frameworkReady: () => new Promise<boolean>(() => undefined),
}));

test('start does not wait for the first pass of a namespace that is not ready', async () => {
  const source = {
    namespace: { id: 'ns-app', appId: 'app' },
    registry: { schedules: new Map([['m.every', {}]]) },
  };
  const never = () => undefined;
  const context = {
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    signal: new AbortController().signal,
    log: { info: never, warn: never, error: never, debug: never },
    namespaces: [source],
    control: { namespace: { id: 'ns-control' } },
    apps: new Map([['app', {}]]),
    queue: {},
  } as unknown as RuntimeServiceContext;
  const ticker = createScheduleTicker();
  // A start that waited for the pass would never return: the time limit of the case fails it.
  await ticker.start(context);
  await ticker.stop(Temporal.Now.instant());
});
