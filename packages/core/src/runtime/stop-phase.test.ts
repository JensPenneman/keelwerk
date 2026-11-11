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
