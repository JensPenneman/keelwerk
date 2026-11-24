import type { ApiSurface, LiveFrame, Runtime, SurfaceAction } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { inProcessLink } from '../src/connections/in-process-link.ts';

const action = {
  ref: 'loans.loanEvents',
  kind: 'subscription',
  input: { optional: false, access: 'read-write', kind: 'void' },
  output: { optional: false, access: 'read-write', kind: 'string' },
} as unknown as SurfaceAction;
const surface = { hash: 'hash-1', actions: [action] } as unknown as ApiSurface;
const failure = new Error('the source failed');

/**
 * What the core's invoker does for one subscription: it holds a slot from its first `next()` until the
 * iterator is returned, ends, or its signal aborts. `how` says what the source does after its first frame.
 */
function runtimeOf(how: 'wait' | 'fail' | 'refuse') {
  const held = { count: 0, signals: [] as AbortSignal[] };
  const runtime = {
    surface: () => surface,
    invoker: {
      subscribe: (invocation: { readonly signal: AbortSignal }) => {
        held.signals.push(invocation.signal);
        let step = 0;
        let holding = false;
        const give = (): void => {
          if (holding) held.count -= 1;
          holding = false;
        };
        const iterator: AsyncIterator<LiveFrame<unknown>> = {
          next() {
            step += 1;
            if (how === 'refuse') return Promise.reject(failure);
            if (step === 1) {
              holding = true;
              held.count += 1;
              return Promise.resolve({ done: false, value: { event: 'one' } });
            }
            if (how === 'fail') {
              give();
              return Promise.reject(failure);
            }
            return new Promise((resolve) =>
              invocation.signal.addEventListener(
                'abort',
                () => {
                  give();
                  resolve({ done: true, value: undefined });
                },
                { once: true },
              ),
            );
          },
          return() {
            give();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
        return { [Symbol.asyncIterator]: () => iterator };
      },
    },
  } as unknown as Runtime;
  return { runtime, held };
}

/** The interrupt signal of the command, with the listeners the link has on it counted. */
function interruptSignal() {
  const controller = new AbortController();
  const listening = { count: 0 };
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
    listening.count += 1;
    add(...args);
  });
  vi.spyOn(controller.signal, 'removeEventListener').mockImplementation((...args) => {
    listening.count -= 1;
    remove(...args);
  });
  return { controller, listening };
}

function open(how: 'wait' | 'fail' | 'refuse') {
  const { runtime, held } = runtimeOf(how);
  const { controller, listening } = interruptSignal();
  const events = inProcessLink(runtime, 'loans').subscribe(
    { action: 'loans.loanEvents' },
    { signal: controller.signal },
  );
  return { events, held, controller, listening };
}

describe('the in-process link and the slot of its subscription', () => {
  test('gives the slot back, aborts the source and removes the interrupt listener when the caller returns', async () => {
    const made = open('wait');
    const iterator = (await made.events)[Symbol.asyncIterator]();
    expect(made.held.count).toBe(1);
    expect(made.listening.count).toBe(1);
    await iterator.return?.(undefined);
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });

  test('gives it back on an interrupt, and the events then end', async () => {
    const made = open('wait');
    const iterator = (await made.events)[Symbol.asyncIterator]();
    await iterator.next();
    const next = iterator.next();
    made.controller.abort();
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(await next).toMatchObject({ done: false, value: { kind: 'end' } });
    expect(made.held.count).toBe(0);
    expect(made.listening.count).toBe(0);
  });

  test('gives it back when the source fails after the first frame, and the failure is an event', async () => {
    const made = open('fail');
    const iterator = (await made.events)[Symbol.asyncIterator]();
    await iterator.next();
    expect(await iterator.next()).toMatchObject({ done: false, value: { kind: 'error' } });
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });

  test('holds nothing and leaves nothing behind when the first frame is refused', async () => {
    const made = open('refuse');
    await expect(made.events).rejects.toBeDefined();
    expect(made.held.count).toBe(0);
    expect(made.held.signals[0]?.aborted).toBe(true);
    expect(made.listening.count).toBe(0);
  });
});
