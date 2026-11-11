import { describe, expect, test, vi } from 'vitest';
import type { RuntimeService } from './runtime-service.ts';
import type { StartPhaseInput } from './start-phase-input.ts';
import { startRuntimeServices } from './start-runtime-services.ts';

const seam = vi.hoisted(() => ({
  sources: undefined as Promise<readonly never[]> | undefined,
  services: [] as RuntimeService[],
}));

vi.mock('../worker/queue-sources.ts', () => ({
  queueSources: () => seam.sources ?? Promise.resolve([]),
}));
vi.mock('./kernel-services.ts', () => ({
  get kernelServices() {
    return seam.services.map((service) => () => service);
  },
}));

const warnings: string[] = [];
const log = {
  debug: () => undefined,
  info: () => undefined,
  warn: (message: string) => warnings.push(message),
  error: () => undefined,
  child: () => log,
};

function inputOf(probe: (probe: unknown) => void = () => undefined): StartPhaseInput {
  return {
    connected: {
      processId: 'p-1',
      log,
      control: { writer: {} },
      keys: {},
      placements: new Map(),
      signal: new AbortController().signal,
    },
    migrated: { directory: { lookup: {} } },
    options: { role: 'all', listen: false, work: { probe } },
    clock: { now: () => Temporal.Now.instant() },
    apps: new Map(),
    invoker: {},
    composed: { infrastructure: { ledgers: [], eventWorkers: [] } },
  } as unknown as StartPhaseInput;
}

/** A service that records its starts and stops; `start` waits at the door when one is given. */
function service(id: string, door?: Promise<void>) {
  const calls: string[] = [];
  const built: RuntimeService = {
    id,
    roles: ['work'],
    start: async () => {
      calls.push('start');
      await door;
    },
    stop: async () => {
      calls.push('stop');
    },
  };
  return { built, calls };
}

describe('startRuntimeServices when the stop gives up on the start', () => {
  test('a stop with an aborted signal before the chain reached its services starts none', async () => {
    const door = Promise.withResolvers<readonly never[]>();
    seam.sources = door.promise;
    const first = service('a');
    seam.services = [first.built];
    const ended: unknown[] = [];
    const stop = startRuntimeServices(inputOf((probe) => ended.push(probe)));
    await stop(AbortSignal.abort());
    door.resolve([]);
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(first.calls).toEqual([]);
  });

  test('a signal that aborts while a service starts stops it at once and starts the next none', async () => {
    seam.sources = undefined;
    const door = Promise.withResolvers<void>();
    const first = service('a', door.promise);
    const second = service('b');
    seam.services = [first.built, second.built];
    const stop = startRuntimeServices(inputOf());
    await vi.waitFor(() => expect(first.calls).toEqual(['start']));
    const abort = new AbortController();
    const stopping = stop(abort.signal);
    abort.abort();
    await stopping;
    door.resolve();
    await vi.waitFor(() => expect(first.calls).toEqual(['start', 'stop']));
    expect(second.calls).toEqual([]);
  });

  test('the probe is handed over after the services started, and a normal stop stops them once', async () => {
    seam.sources = undefined;
    const door = Promise.withResolvers<void>();
    const first = service('a', door.promise);
    seam.services = [first.built];
    const handed: unknown[] = [];
    const stop = startRuntimeServices(inputOf((probe) => handed.push(probe)));
    await vi.waitFor(() => expect(first.calls).toEqual(['start']));
    expect(handed).toEqual([]);
    door.resolve();
    await stop(AbortSignal.timeout(5000));
    expect(handed).toHaveLength(1);
    expect(first.calls).toEqual(['start', 'stop']);
  });
});
