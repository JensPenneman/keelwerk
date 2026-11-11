import { expect, test, vi } from 'vitest';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import { createScheduleTicker } from './schedule-ticker.ts';

const gate = vi.hoisted(() => ({ wait: undefined as unknown }));

vi.mock('../worker/framework-ready.ts', () => ({ frameworkReady: async () => true }));
vi.mock('./run-schedule-pass.ts', () => ({
  runSchedulePass: async () => {
    await gate.wait;
    throw new Error('cut short by the stop');
  },
}));

test('a pass that fails while the ticker is stopping is not logged as a failed pass', async () => {
  let release: () => void = () => undefined;
  gate.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const logged: string[] = [];
  const record = (message: string): void => {
    logged.push(message);
  };
  const source = {
    namespace: { id: 'ns-app', appId: 'app' },
    registry: { schedules: new Map([['m.every', {}]]) },
  };
  const context = {
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    log: { info: record, warn: record, error: record, debug: record },
    namespaces: [source],
    control: { namespace: { id: 'ns-control' } },
    apps: new Map([['app', {}]]),
    queue: {},
  } as unknown as RuntimeServiceContext;
  const ticker = createScheduleTicker();
  await ticker.start(context);
  const stopped = ticker.stop(Temporal.Now.instant().add({ seconds: 30 }));
  release();
  await stopped;
  expect(logged.filter((message) => message.includes('failed'))).toEqual([]);
});

test('the same failure is logged when the ticker is not stopping', async () => {
  gate.wait = Promise.resolve();
  const logged: string[] = [];
  const record = (message: string): void => {
    logged.push(message);
  };
  const source = {
    namespace: { id: 'ns-app', appId: 'app' },
    registry: { schedules: new Map([['m.every', {}]]) },
  };
  const context = {
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    log: { info: record, warn: record, error: record, debug: record },
    namespaces: [source],
    control: { namespace: { id: 'ns-control' } },
    apps: new Map([['app', {}]]),
    queue: {},
  } as unknown as RuntimeServiceContext;
  const ticker = createScheduleTicker();
  await ticker.start(context);
  await vi.waitFor(() => expect(logged).toContain('a schedule pass failed'));
  await ticker.stop(Temporal.Now.instant());
});
