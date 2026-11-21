import { describe, expect, test, vi } from 'vitest';
import { createServiceGate } from './create-service-gate.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { StartPhaseInput } from './start-phase-input.ts';
import { startRuntimeServices } from './start-runtime-services.ts';
import { staysInService } from './stays-in-service.ts';

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

function inputOf(
  probe: (probe: unknown) => void = () => undefined,
  extra: {
    readonly gate?: ReturnType<typeof createServiceGate>;
    readonly signal?: AbortSignal;
  } = {},
): StartPhaseInput {
  return {
    ...(extra.gate === undefined ? {} : { gate: extra.gate }),
    connected: {
      processId: 'p-1',
      log,
      control: { writer: {} },
      keys: {},
      placements: new Map(),
      signal: extra.signal ?? new AbortController().signal,
    },
    migrated: { directory: { lookup: {} } },
    options: { role: 'all', listen: false, work: { probe } },
    clock: { now: () => Temporal.Now.instant() },
    apps: new Map(),
    invoker: {},
    composed: { infrastructure: { ledgers: [], eventWorkers: [] } },
  } as unknown as StartPhaseInput;
}

/** A service that records its starts and stops, and the signal it got; `start` waits at the door when one is given. */
function service(id: string, door?: Promise<void>) {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const built: RuntimeService = {
    id,
    roles: ['work'],
    start: async (context) => {
      calls.push('start');
      signals.push(context.signal);
      await door;
    },
    stop: async () => {
      calls.push('stop');
    },
  };
  return { built, calls, signals };
}

describe('startRuntimeServices when the stop gives up on the start', () => {
  test('a stop with an aborted signal before the chain reached its services starts none', async () => {
    const door = Promise.withResolvers<readonly never[]>();
    seam.sources = door.promise;
    const first = service('a');
    seam.services = [first.built];
    const ended: unknown[] = [];
    const stop = startRuntimeServices(inputOf((probe) => ended.push(probe)));
    const stopping = stop(AbortSignal.abort());
    door.resolve([]);
    await stopping;
    expect(ended).toHaveLength(1);
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
    door.resolve();
    // The stop returns only after the late chain has stopped what it started.
    await stopping;
    expect(first.calls).toEqual(['start', 'stop']);
    expect(second.calls).toEqual([]);
  });

  test('a stop whose deadline passed before a service start ended returns after that service was stopped', async () => {
    seam.sources = undefined;
    const door = Promise.withResolvers<void>();
    const first = service('a', door.promise);
    seam.services = [first.built];
    const stop = startRuntimeServices(inputOf());
    await vi.waitFor(() => expect(first.calls).toEqual(['start']));
    let returned = false;
    const stopping = stop(AbortSignal.abort()).then(() => {
      returned = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(returned).toBe(false);
    door.resolve();
    await stopping;
    expect(first.calls).toEqual(['start', 'stop']);
  });

  test('a start that never ends holds the stop for the give-back bound only', async () => {
    seam.sources = undefined;
    const first = service('a', new Promise<void>(() => undefined));
    seam.services = [first.built];
    const stop = startRuntimeServices(inputOf());
    await vi.waitFor(() => expect(first.calls).toEqual(['start']));
    vi.useFakeTimers();
    try {
      let returned = false;
      const stopping = stop(AbortSignal.abort()).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(returned).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      expect(returned).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

describe('startRuntimeServices when the stop deadline passes before a service stopped', () => {
  const started: string[] = [];
  function slow(expire?: () => Promise<void>): RuntimeService {
    return {
      id: 'slow',
      roles: ['work'],
      start: async () => {
        started.push('slow');
      },
      stop: () => new Promise<void>(() => undefined),
      ...(expire === undefined ? {} : { expire }),
    };
  }

  test('asks each service to give back what it holds, and returns only when that is done', async () => {
    seam.sources = undefined;
    const release = Promise.withResolvers<void>();
    const expire = vi.fn(() => release.promise);
    started.length = 0;
    seam.services = [slow(expire), slow()];
    const stop = startRuntimeServices(inputOf());
    await vi.waitFor(() => expect(started).toHaveLength(2), { timeout: 30_000 });
    const abort = new AbortController();
    let returned = false;
    const stopping = stop(abort.signal).then(() => {
      returned = true;
    });
    abort.abort();
    await vi.waitFor(() => expect(expire).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    expect(returned).toBe(false);
    release.resolve();
    await stopping;
    expect(returned).toBe(true);
  });

  test('a service that stops in time is not asked to give anything back', async () => {
    seam.sources = undefined;
    const expire = vi.fn(() => Promise.resolve());
    const quick = service('quick');
    seam.services = [{ ...quick.built, expire }];
    const stop = startRuntimeServices(inputOf());
    await stop(AbortSignal.timeout(30_000));
    expect(expire).not.toHaveBeenCalled();
  });

  test('a service whose give-back fails is logged and the stop goes on', async () => {
    seam.sources = undefined;
    warnings.length = 0;
    started.length = 0;
    seam.services = [slow(() => Promise.reject(new Error('store gone')))];
    const stop = startRuntimeServices(inputOf());
    await vi.waitFor(() => expect(started).toHaveLength(1), { timeout: 30_000 });
    await stop(AbortSignal.abort());
    expect(warnings).toContain('a runtime service did not give back what it holds');
  });
});

describe('the signal of a started service', () => {
  test('aborts when the gate closes with its evidence pending, except for the services that stay in service', async () => {
    seam.sources = undefined;
    const ordinary = [service('kernel.anything'), service('events.added-later')];
    const staying = [...staysInService].map((id) => service(id));
    seam.services = [...ordinary, ...staying].map(({ built }) => built);
    const gate = createServiceGate();
    const environment = new AbortController();
    const stop = startRuntimeServices(inputOf(undefined, { gate, signal: environment.signal }));
    await vi.waitFor(() => {
      for (const kit of [...ordinary, ...staying]) expect(kit.calls).toEqual(['start']);
    });
    const signalOf = (kit: { readonly signals: readonly AbortSignal[] }): AbortSignal => {
      const [signal] = kit.signals;
      if (signal === undefined) throw new Error('the service was not started');
      return signal;
    };
    for (const kit of [...ordinary, ...staying]) expect(signalOf(kit).aborted).toBe(false);
    gate.close('position', { evidence: 'pending' });
    for (const kit of ordinary) expect(signalOf(kit).aborted).toBe(true);
    for (const kit of staying) expect(signalOf(kit).aborted).toBe(false);
    // The teardown of the process still reaches every service.
    environment.abort();
    for (const kit of staying) expect(signalOf(kit).aborted).toBe(true);
    await stop(AbortSignal.timeout(5000));
  });

  test('is the environment signal in a start without a gate', async () => {
    seam.sources = undefined;
    const only = service('kernel.anything');
    seam.services = [only.built];
    const environment = new AbortController();
    const stop = startRuntimeServices(inputOf(undefined, { signal: environment.signal }));
    await vi.waitFor(() => expect(only.calls).toEqual(['start']));
    expect(only.signals[0]?.aborted).toBe(false);
    environment.abort();
    expect(only.signals[0]?.aborted).toBe(true);
    await stop(AbortSignal.timeout(5000));
  });

  test('is aborted at start for a service that starts after the gate closed', async () => {
    seam.sources = undefined;
    const door = Promise.withResolvers<void>();
    const first = service('kernel.first', door.promise);
    const second = service('kernel.second');
    seam.services = [first.built, second.built];
    const gate = createServiceGate();
    const stop = startRuntimeServices(inputOf(undefined, { gate }));
    await vi.waitFor(() => expect(first.calls).toEqual(['start']));
    gate.close('identity');
    door.resolve();
    await vi.waitFor(() => expect(second.calls).toEqual(['start']));
    expect(second.signals[0]?.aborted).toBe(true);
    await stop(AbortSignal.timeout(5000));
  });
});
