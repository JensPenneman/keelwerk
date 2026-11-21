import { describe, expect, test, vi } from 'vitest';
import type { RuntimeLiveHub } from '../live/runtime-live-hub.ts';
import type { Connected } from './connected.ts';
import { stopPhase } from './stop-phase.ts';

vi.mock('../control/set-process-state.ts', () => ({ setProcessState: () => Promise.resolve() }));

/** What the stop did and in which order. */
function setup(hubClose: (deadline: AbortSignal) => Promise<void>) {
  const order: string[] = [];
  const warnings: string[] = [];
  const deadlines: AbortSignal[] = [];
  const hub = {
    close: (deadline: AbortSignal) => {
      order.push('hub');
      deadlines.push(deadline);
      return hubClose(deadline);
    },
  } as unknown as RuntimeLiveHub;
  const connected = {
    control: {},
    processId: 'p1',
    log: { warn: (message: string) => warnings.push(message) },
    compute: { close: () => Promise.resolve() },
    adapters: [{ close: () => Promise.resolve() }],
  } as unknown as Connected;
  const input = {
    connected,
    started: {
      stopPhases: () => Promise.resolve(),
      unfollow: () => order.push('unfollow'),
      following: Promise.resolve(),
    },
    draining: {
      drain: () => order.push('drain'),
      idle: () => {
        order.push('idle');
        return Promise.resolve();
      },
    },
    mounts: [
      {
        close: () => {
          order.push('mount');
          return Promise.resolve();
        },
      },
      {
        close: () => {
          order.push('mount');
          return Promise.resolve();
        },
      },
    ],
    abort: new AbortController(),
    anchoring: { stop: () => Promise.resolve() },
    hubs: [hub],
  };
  return { input: input as unknown as Parameters<typeof stopPhase>[0], order, warnings, deadlines };
}

describe('stopPhase and the live hubs', () => {
  test('a live hub closes after every mount was asked to close and before the drain is awaited', async () => {
    const { input, order, deadlines } = setup(() => Promise.resolve());
    await stopPhase(input, 1000);
    expect(order).toEqual(['drain', 'mount', 'mount', 'hub', 'idle', 'unfollow']);
    expect(deadlines[0]?.aborted).toBe(false);
  });

  test('a hub that fails to close is logged and the stop goes on', async () => {
    const { input, order, warnings } = setup(() => Promise.reject(new Error('stuck')));
    await stopPhase(input, 1000);
    expect(warnings).toContain('a live hub did not close cleanly');
    expect(order.slice(-2)).toEqual(['idle', 'unfollow']);
  });

  test('a hub that never closes holds the stop only until the deadline', async () => {
    const { input, order } = setup(() => new Promise<void>(() => undefined));
    const started = performance.now();
    await stopPhase(input, 100);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(order).toContain('unfollow');
  });
});

describe('stopPhase and what the services give back at the deadline', () => {
  test('the adapters close only after the phases returned, which may outlast the deadline', async () => {
    const { input } = setup(() => Promise.resolve());
    const events: string[] = [];
    const phases = Promise.withResolvers<void>();
    const phased = input as unknown as {
      started: { stopPhases: () => Promise<void> };
      connected: { adapters: { close: () => Promise<void> }[] };
      abort: AbortController;
    };
    phased.abort.signal.addEventListener('abort', () => events.push('aborted'));
    phased.started.stopPhases = () => phases.promise.then(() => void events.push('phases'));
    phased.connected.adapters = [
      {
        close: () => {
          events.push('closed');
          return Promise.resolve();
        },
      },
    ];
    const stopping = stopPhase(input, 20);
    await vi.waitFor(() => expect(events).toEqual(['aborted']), { timeout: 30_000 });
    phases.resolve();
    await stopping;
    expect(events).toEqual(['aborted', 'phases', 'closed']);
  });
});
