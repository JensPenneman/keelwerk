import { expect, test, vi } from 'vitest';
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
    log: { info: never, warn: never, error: never, debug: never },
    namespaces: [source],
    control: { namespace: { id: 'ns-control' } },
    apps: new Map([['app', {}]]),
    queue: {},
  } as unknown as RuntimeServiceContext;
  const ticker = createScheduleTicker();
  const started = ticker.start(context).then(() => 'started' as const);
  const timeout = new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500));
  expect(await Promise.race([started, timeout])).toBe('started');
  await ticker.stop(Temporal.Now.instant());
});
