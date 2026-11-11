import type { DataAdapter, LiveKernel, Logger, Unit } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { createScopeReaders } from '../../src/hub/create-scope-readers.ts';
import { fakeListener, fakeView, limits } from './support/fake-scope.ts';

interface Entry {
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A log that keeps every line with the fields bound by `child`. */
function recordingLog(lines: Entry[], bound: Readonly<Record<string, unknown>> = {}): Logger {
  const write = (message: string, fields?: Readonly<Record<string, unknown>>): void => {
    lines.push({ message, fields: { ...bound, ...fields } });
  };
  return {
    debug: write,
    info: write,
    warn: write,
    error: write,
    child: (more: Readonly<Record<string, unknown>>) => recordingLog(lines, { ...bound, ...more }),
  } as unknown as Logger;
}

/** An adapter whose change feed waits for its signal, or fails; `read` is what a pass does. */
function fakeAdapter(options: { readonly feedFails?: boolean } = {}) {
  const signals: AbortSignal[] = [];
  const adapter = {
    feed: {
      wake: async function* (_namespaces: unknown, signal: AbortSignal) {
        signals.push(signal);
        if (options.feedFails === true) throw new Error('the feed is gone');
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      },
    },
  } as unknown as DataAdapter;
  return { adapter, signals };
}

/** The kernel of one tenant's session over a backend entity of the scope `backend-1`. */
function kernelOf(
  adapter: DataAdapter,
  audience: string,
  read: LiveKernel['read'],
  lines: Entry[],
): LiveKernel {
  return {
    entity: 't.card',
    descriptor: {},
    scopeId: 'backend-1',
    audience,
    log: recordingLog(lines, { backend: 'backend-1', tenant: audience }),
    target: { namespace: { id: 'ns-1' }, handle: { adapter } },
    isProcessStream: () => false,
    read,
  } as unknown as LiveKernel;
}

const idle = (async <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
  fn({
    events: { head: async () => 0n, readAll: async () => ({ events: [], next: null }) },
    rows: { find: async () => ({ rows: [] }) },
  } as unknown as Unit)) as LiveKernel['read'];

const broken = (() => Promise.reject(new Error('the database is gone'))) as LiveKernel['read'];

function setup(over: Parameters<typeof limits>[0] = {}, adapterOptions = {}) {
  const lines: Entry[] = [];
  const { adapter, signals } = fakeAdapter(adapterOptions);
  const readers = createScopeReaders(limits(over), {
    clock: { now: () => Temporal.Now.instant() },
    log: recordingLog(lines),
  });
  return { readers, adapter, signals, lines };
}

describe('the readers of a hub', () => {
  test('tenants of one backend count their subscriptions apart: one at the bound does not refuse another', () => {
    const { readers, adapter, lines } = setup({ maxSubscribersPerScope: 2 });
    const a = kernelOf(adapter, 'tenant-a', idle, lines);
    const b = kernelOf(adapter, 'tenant-b', idle, lines);
    readers.attach(a, fakeListener(fakeView('A')).listener);
    readers.attach(a, fakeListener(fakeView('A')).listener);
    expect(() => readers.attach(a, fakeListener(fakeView('A')).listener)).toThrow(
      expect.objectContaining({
        kind: 'unavailable',
        message: 'Live updates are not available now.',
      }),
    );
    expect(() => readers.attach(b, fakeListener(fakeView('A')).listener)).not.toThrow();
  });

  test("a tenant's failing passes end that tenant's listeners and no other's", async () => {
    const { readers, adapter, lines } = setup({ pollMs: 10 });
    const failing = fakeListener(fakeView('A'));
    const healthy = fakeListener(fakeView('A'));
    readers.attach(kernelOf(adapter, 'tenant-a', broken, lines), failing.listener);
    readers.attach(kernelOf(adapter, 'tenant-b', idle, lines), healthy.listener);
    await vi.waitFor(() => expect(failing.failures).toHaveLength(1));
    await vi.waitFor(() => expect(healthy.joined).toHaveLength(1));
    expect(healthy.failures).toHaveLength(0);
  });

  test('the process bound refuses with the same neutral message and logs which bound applied', () => {
    const { readers, adapter, lines } = setup({ maxSubscribers: 1 });
    readers.attach(
      kernelOf(adapter, 'tenant-a', idle, lines),
      fakeListener(fakeView('A')).listener,
    );
    expect(() =>
      readers.attach(
        kernelOf(adapter, 'tenant-b', idle, lines),
        fakeListener(fakeView('A')).listener,
      ),
    ).toThrow(
      expect.objectContaining({
        kind: 'unavailable',
        message: 'Live updates are not available now.',
      }),
    );
    expect(
      lines.find((line) => line.message === 'a live subscription was refused')?.fields,
    ).toMatchObject({
      bound: 'subscribers of the process',
      count: 1,
      limit: 1,
    });
  });

  test('a failed change feed is logged with the namespace only, whichever tenant reader joined it', async () => {
    const { readers, adapter, lines } = setup({ pollMs: 10_000 }, { feedFails: true });
    readers.attach(
      kernelOf(adapter, 'tenant-a', idle, lines),
      fakeListener(fakeView('A')).listener,
    );
    readers.attach(
      kernelOf(adapter, 'tenant-b', idle, lines),
      fakeListener(fakeView('A')).listener,
    );
    await vi.waitFor(() =>
      expect(
        lines.some((line) => line.message === 'the change feed of the live readers failed'),
      ).toBe(true),
    );
    const line = lines.find((one) => one.message === 'the change feed of the live readers failed');
    expect(line?.fields).toEqual({ namespace: 'ns-1', code: 'Error' });
  });

  test('close ends every listener without an error, aborts the wake loop and refuses later attaches', async () => {
    const { readers, adapter, signals, lines } = setup({ pollMs: 10_000 });
    const one = fakeListener(fakeView('A'));
    const two = fakeListener(fakeView('A'));
    readers.attach(kernelOf(adapter, 'tenant-a', idle, lines), one.listener);
    readers.attach(kernelOf(adapter, 'tenant-b', idle, lines), two.listener);
    await vi.waitFor(() => expect(one.joined).toHaveLength(1));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    await readers.close(AbortSignal.timeout(2000));
    expect(one.ends).toHaveLength(1);
    expect(two.ends).toHaveLength(1);
    expect(one.failures).toHaveLength(0);
    expect(signals[0]?.aborted).toBe(true);
    expect(() =>
      readers.attach(
        kernelOf(adapter, 'tenant-a', idle, lines),
        fakeListener(fakeView('A')).listener,
      ),
    ).toThrow(expect.objectContaining({ kind: 'unavailable' }));
  });

  test('close resolves at the deadline when a pass hangs', async () => {
    const { readers, adapter, lines } = setup({ passTimeoutMs: 60_000, pollMs: 10_000 });
    const stuck = (() => new Promise(() => undefined)) as unknown as LiveKernel['read'];
    const one = fakeListener(fakeView('A'));
    readers.attach(kernelOf(adapter, 'tenant-a', stuck, lines), one.listener);
    const deadline = new AbortController();
    const closing = readers.close(deadline.signal);
    let done = false;
    void closing.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(done).toBe(false);
    deadline.abort();
    await closing;
    expect(done).toBe(true);
    expect(one.ends).toHaveLength(1);
  });
});
