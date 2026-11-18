import { describe, expect, test, vi } from 'vitest';
import type { RestoreHold } from '../control/restore-hold.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { StartPhaseInput } from '../runtime/start-phase-input.ts';
import { createWorker } from './create-worker.ts';
import type { RunJobContext } from './run-job.ts';

const seen = vi.hoisted(() => ({ contexts: [] as unknown[] }));
vi.mock('./run-job.ts', () => ({
  runJob: (_job: unknown, context: unknown) => {
    seen.contexts.push(context);
    return Promise.resolve();
  },
}));

function setup(options: { restoreHold?: RestoreHold } = {}) {
  const drained: Temporal.Instant[] = [];
  const handlers: ((job: unknown) => Promise<void>)[] = [];
  const queue = {
    probe: {},
    sourceOf: () => ({}),
    work: async (_name: string, handler: (job: unknown) => Promise<void>) => {
      handlers.push(handler);
      return {
        drain: async (deadline: Temporal.Instant) => {
          drained.push(deadline);
          return 0;
        },
      };
    },
  };
  const input = {
    connected: {
      processId: 'p',
      control: { writer: {} },
      log: {},
      keys: {},
      build: { revision: 1 },
    },
    migrated: { directory: { lookup: {} } },
    options: { work: { slots: { effects: 1 }, capabilities: [] } },
    composed: { infrastructure: { ledgers: [] } },
    apps: new Map(),
    invoker: {},
    clock: { now: () => Temporal.Now.instant() },
    ...(options.restoreHold === undefined ? {} : { restoreHold: options.restoreHold }),
  } as unknown as StartPhaseInput;
  const controller = new AbortController();
  const context = { queue, signal: controller.signal } as unknown as RuntimeServiceContext;
  return { service: createWorker(input), context, drained, handlers, controller };
}

describe('the core.workers service', () => {
  test('hands the restore hold to every job it runs', async () => {
    seen.contexts.length = 0;
    const hold = { holds: () => false } as unknown as RestoreHold;
    const kit = setup({ restoreHold: hold });
    await kit.service.start(kit.context);
    await kit.handlers[0]?.({});
    expect((seen.contexts[0] as RunJobContext).restoreHold).toBe(hold);
  });

  test('drains every fetcher at once when its signal aborts: the process stops or leaves service', async () => {
    const kit = setup();
    await kit.service.start(kit.context);
    expect(kit.drained).toEqual([]);
    kit.controller.abort();
    expect(kit.drained.length).toBeGreaterThan(0);
  });

  test('drains at once when the signal is already aborted at start', async () => {
    const kit = setup();
    kit.controller.abort();
    await kit.service.start(kit.context);
    expect(kit.drained.length).toBeGreaterThan(0);
  });
});
