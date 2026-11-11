import type { LiveKernel, LiveView } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { createLiveHub } from '../../src/hub/create-live-hub.ts';

/** The kernel the mocked `liveKernelOf` answers: its view is built when the test says so. */
const kernels: { current: LiveKernel | undefined } = { current: undefined };

vi.mock('@keelwerk/core', async (original) => {
  const real = await original<typeof import('@keelwerk/core')>();
  return {
    ...real,
    liveKernelOf: () => {
      if (kernels.current === undefined) throw new Error('no kernel');
      return kernels.current;
    },
  };
});

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function hubWithSlowView() {
  let finish: ((view: LiveView) => void) | undefined;
  kernels.current = {
    entity: 't.card',
    scopeId: 's',
    audience: 'a',
    log: silent,
    target: { namespace: { id: 'ns' }, handle: { adapter: {} } },
    view: () =>
      new Promise<LiveView>((resolve) => {
        finish = resolve;
      }),
  } as unknown as LiveKernel;
  const hub = createLiveHub({ clock: { now: () => Temporal.Now.instant() }, log: silent as never });
  return { hub, finish: (view: LiveView) => finish?.(view) };
}

describe('closing a hub while a subscription is still building its view', () => {
  test('the stream ends without an error and nothing attaches to a reader', async () => {
    const { hub, finish } = hubWithSlowView();
    const iterator = hub.entity({} as never, 't.card', {})[Symbol.asyncIterator]();
    const first = iterator.next();
    // The subscription is listed from the start of its first `next()`.
    await vi.waitFor(() => expect(hub.subscriptions()).toHaveLength(1));
    await hub.close(AbortSignal.timeout(2000));
    finish({
      planKey: 'A',
      entity: 't.card',
      after: undefined,
      from: 'now',
    } as unknown as LiveView);
    await expect(first).resolves.toEqual({ done: true, value: undefined });
    expect(hub.subscriptions()).toHaveLength(0);
  });

  test('a stream first read after the close is refused core.unavailable, and every member of a closed hub says so', async () => {
    const { hub } = hubWithSlowView();
    const waiting = hub.entity({} as never, 't.card', {})[Symbol.asyncIterator]();
    await hub.close(AbortSignal.timeout(2000));
    await expect(waiting.next()).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'The live hub has stopped.',
    });
    const members = [
      hub.entity({} as never, 't.card', {}),
      hub.pokes({} as never),
      hub.stream({} as never, 's', 'k', { from: 'now' }),
      hub.topic({} as never, 't', 'k'),
    ];
    for (const member of members) {
      await expect(member[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        kind: 'unavailable',
        code: 'core.unavailable',
        message: 'The live hub has stopped.',
      });
    }
  });
});
