import type { RuntimeServiceContext } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { erasure } from '../../src/erasure/erasure.ts';

const record = { type: 'erasure', tenantId: 'tenant-1', commandId: 'command-1', subjectId: 'ada' };
const pollMs = 1_000;

/** A context over a fake control ledger that holds one unfinished record and serves no namespace; `known` is what the archived directory answers for the tenant. */
function contextOf(known: boolean, served?: { readonly backend: boolean }) {
  const warn = vi.fn();
  const tenant = vi.fn(async () =>
    known ? { id: 'tenant-1', backendId: 'backend-1', namespace: { id: 'ns-1' } } : undefined,
  );
  const backend = vi.fn(async () =>
    served?.backend === true ? { id: 'backend-1', namespace: { id: 'ns-1' } } : undefined,
  );
  const never = (): void => undefined;
  const context = {
    signal: new AbortController().signal,
    log: { debug: never, info: never, warn, error: never },
    control: {
      deploymentId: 'd-1',
      epochs: () => new Map(),
      ledger: {
        unfinished: async () => ({ erasures: [{ record, seq: 1n }], head: 1n }),
        since: async () => [],
      },
    },
    namespaces: served === undefined ? [] : [{ namespace: { id: 'ns-1' }, handle: {} }],
    archivedDirectory: { tenant, backend },
  } as unknown as RuntimeServiceContext;
  return { context, warn, tenant, backend };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the erasure worker finds no namespace for the tenant of a record', () => {
  test('a tenant nobody knows stays in the retry set: the poll looks at it again, and it is warned about once', async () => {
    vi.useFakeTimers();
    const kit = contextOf(false);
    const worker = erasure({ pollMs });
    await worker.start(kit.context);
    expect(kit.tenant).toHaveBeenCalledTimes(1);
    for (let poll = 1; poll <= 3; poll += 1) {
      await vi.advanceTimersByTimeAsync(pollMs);
      expect(kit.tenant).toHaveBeenCalledTimes(1 + poll);
    }
    expect(kit.warn).toHaveBeenCalledTimes(1);
    await worker.stop(Temporal.Now.instant());
  });

  test('a tenant of a placement this process does not open is left to the process that does: looked at once, never again', async () => {
    vi.useFakeTimers();
    const kit = contextOf(true);
    const worker = erasure({ pollMs });
    await worker.start(kit.context);
    await vi.advanceTimersByTimeAsync(3 * pollMs);
    expect(kit.tenant).toHaveBeenCalledTimes(1);
    expect(kit.warn).toHaveBeenCalledTimes(1);
    expect(kit.warn.mock.calls[0]?.[0]).toBe(
      'an erasure record names a tenant this process does not serve',
    );
    await worker.stop(Temporal.Now.instant());
  });

  test('a tenant whose backend this process does not serve is left to a process that serves both', async () => {
    vi.useFakeTimers();
    const kit = contextOf(true, { backend: false });
    const worker = erasure({ pollMs });
    await worker.start(kit.context);
    await vi.advanceTimersByTimeAsync(3 * pollMs);
    expect(kit.tenant.mock.calls.length).toBeGreaterThan(0);
    expect(kit.warn).toHaveBeenCalledTimes(1);
    expect(kit.warn.mock.calls[0]?.[0]).toBe(
      'an erasure record names a tenant whose backend this process does not serve',
    );
    await worker.stop(Temporal.Now.instant());
  });
});
