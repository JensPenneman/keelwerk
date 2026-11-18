import { describe, expect, test } from 'vitest';
import type { Invoker } from '../invoker/invoker.ts';
import { createServiceGate } from './create-service-gate.ts';
import { drainingInvoker } from './draining-invoker.ts';
import type { ServiceGate } from './service-gate.ts';

/** A source whose iterators wait on `release()` for each item and count their `return` calls. */
function subscriptionKit() {
  const state = { opened: 0, returned: 0, release: (): void => undefined };
  const subscribe = () => ({
    [Symbol.asyncIterator]: () => {
      state.opened += 1;
      return {
        next: () =>
          new Promise<IteratorResult<unknown>>((resolve) => {
            state.release = () => resolve({ done: false, value: { control: 'gap' } });
          }),
        return: async () => {
          state.returned += 1;
          return { done: true as const, value: undefined };
        },
      };
    },
  });
  return { state, subscribe };
}

/** A gate whose signal counts the listeners that are registered on it and not yet removed. */
function countingGate(): { readonly gate: ServiceGate; readonly listeners: () => number } {
  const real = createServiceGate();
  const live = new Set<unknown>();
  const signal = {
    addEventListener: (type: string, listener: unknown) => {
      live.add(listener);
      real.signal.addEventListener(type, listener as () => void, { once: true });
    },
    removeEventListener: (type: string, listener: unknown) => {
      live.delete(listener);
      real.signal.removeEventListener(type, listener as () => void);
    },
  } as unknown as AbortSignal;
  // `closed` is read through to the real gate, so a fake that closes still reads closed.
  const gate: ServiceGate = {
    get closed() {
      return real.closed;
    },
    whenClosed: real.whenClosed,
    outOfService: real.outOfService,
    close: real.close,
    recorded: real.recorded,
    signal,
  };
  return { gate, listeners: () => live.size };
}

const kit = subscriptionKit();
const inner = {
  open: async () => ({ ok: true, value: {} }),
  invoke: async () => ({ ok: true, value: 1 }),
  subscribe: kit.subscribe,
} as unknown as Invoker;
const invocation = { ref: 'm.up' } as never;

describe('the draining invoker', () => {
  test('refuses new invocations once draining, with core.unavailable', async () => {
    const draining = drainingInvoker(inner);
    expect(await draining.invoker.invoke(invocation)).toMatchObject({ ok: true });
    draining.drain();
    expect(await draining.invoker.invoke(invocation)).toMatchObject({
      ok: false,
      error: { code: 'core.unavailable' },
    });
  });

  test('refuses new invocations once the gate closed, with core.unavailable', async () => {
    const gate = createServiceGate();
    const draining = drainingInvoker(inner, gate);
    expect(await draining.invoker.invoke(invocation)).toMatchObject({ ok: true });
    gate.close('position');
    expect(await draining.invoker.invoke(invocation)).toMatchObject({
      ok: false,
      error: { code: 'core.unavailable', retryable: true },
    });
    expect(await gate.whenClosed).toBe('position');
    gate.close('identity');
    expect(await gate.whenClosed).toBe('position');
  });

  test('refuses open once the gate closed, with core.unavailable', async () => {
    const gate = createServiceGate();
    const draining = drainingInvoker(inner, gate);
    expect(await draining.invoker.open({} as never)).toMatchObject({ ok: true });
    gate.close('position');
    expect(await draining.invoker.open({} as never)).toMatchObject({
      ok: false,
      error: { code: 'core.unavailable', retryable: true },
    });
  });

  test('a subscription started after the gate closed throws core.unavailable and opens no source', async () => {
    const gate = createServiceGate();
    const draining = drainingInvoker(inner, gate);
    gate.close('position');
    const opened = kit.state.opened;
    const iterator = draining.invoker
      .subscribe(invocation, { after: 'token' as never })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(kit.state.opened).toBe(opened);
  });

  test('a running subscription ends with core.unavailable when the gate closes, and its source is returned', async () => {
    const gate = createServiceGate();
    const draining = drainingInvoker(inner, gate);
    const iterator = draining.invoker.subscribe(invocation)[Symbol.asyncIterator]();
    const first = iterator.next();
    kit.state.release();
    expect(await first).toMatchObject({ done: false });
    const pending = iterator.next();
    const returned = kit.state.returned;
    gate.close('identity');
    await expect(pending).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(kit.state.returned).toBe(returned + 1);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'core.unavailable' });
  });

  test('without a gate the subscription passes through', async () => {
    const draining = drainingInvoker(inner);
    const iterator = draining.invoker.subscribe(invocation)[Symbol.asyncIterator]();
    const first = iterator.next();
    kit.state.release();
    expect(await first).toMatchObject({ done: false });
  });

  test('a subscription that returned leaves no listener on the gate', async () => {
    const counting = countingGate();
    const draining = drainingInvoker(inner, counting.gate);
    const iterator = draining.invoker.subscribe(invocation)[Symbol.asyncIterator]();
    const first = iterator.next();
    kit.state.release();
    await first;
    expect(counting.listeners()).toBe(1);
    await iterator.return?.();
    expect(counting.listeners()).toBe(0);
  });

  test('a subscription that finished or failed leaves no listener on the gate', async () => {
    const counting = countingGate();
    const opened = { finishing: 0, failing: 0 };
    const finishing = {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => {
          opened.finishing += 1;
          return { next: async () => ({ done: true, value: undefined }) };
        },
      }),
    } as unknown as Invoker;
    const failing = {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => {
          opened.failing += 1;
          return { next: () => Promise.reject(new Error('source failed')) };
        },
      }),
    } as unknown as Invoker;
    const done = drainingInvoker(finishing, counting.gate).invoker.subscribe(invocation);
    const finished = done[Symbol.asyncIterator]();
    expect(counting.listeners()).toBe(1);
    expect(await finished.next()).toMatchObject({ done: true });
    expect(counting.listeners()).toBe(0);
    expect(await finished.next()).toMatchObject({ done: true });
    // A finished subscription never opens its source again.
    expect(opened.finishing).toBe(1);
    const broken = drainingInvoker(failing, counting.gate).invoker.subscribe(invocation);
    const failed = broken[Symbol.asyncIterator]();
    expect(counting.listeners()).toBe(1);
    await expect(failed.next()).rejects.toThrow('source failed');
    expect(counting.listeners()).toBe(0);
    expect(await failed.next()).toMatchObject({ done: true });
    expect(opened.failing).toBe(1);
  });

  test('a subscription that ended with the gate leaves no listener on it', async () => {
    const counting = countingGate();
    const draining = drainingInvoker(inner, counting.gate);
    const iterator = draining.invoker.subscribe(invocation)[Symbol.asyncIterator]();
    const pending = iterator.next();
    expect(counting.listeners()).toBe(1);
    counting.gate.close('position');
    await expect(pending).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(counting.listeners()).toBe(0);
  });
});
