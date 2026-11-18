import type { RuntimeServiceContext } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { erasure } from '../../src/erasure/erasure.ts';

const record = { type: 'erasure', tenantId: 'tenant-1', commandId: 'command-1', subjectId: 'ada' };

/** A context over a fake control ledger; `reached()` tells whether a record was looked at. */
function contextOf(signal: AbortSignal) {
  let reached = false;
  const since = vi.fn(async () => []);
  const never = (): void => undefined;
  const context = {
    signal,
    log: { debug: never, info: never, warn: never, error: never },
    control: {
      deploymentId: 'd-1',
      epochs: () => new Map(),
      ledger: {
        unfinished: async () => ({ erasures: [{ record, seq: 1n }], head: 1n }),
        since,
      },
    },
    get namespaces() {
      reached = true;
      return [];
    },
  } as unknown as RuntimeServiceContext;
  return { context, since, reached: () => reached };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the erasure worker in a process that leaves service', () => {
  test('finishes no record when its signal aborted before the start', async () => {
    const kit = contextOf(AbortSignal.abort());
    const worker = erasure({ pollMs: 5 });
    await worker.start(kit.context);
    await pause(60);
    expect(kit.reached()).toBe(false);
    expect(kit.since).not.toHaveBeenCalled();
    await worker.stop(Temporal.Now.instant());
  });

  test('polls no more once its signal aborts', async () => {
    const leaving = new AbortController();
    const kit = contextOf(leaving.signal);
    const worker = erasure({ pollMs: 5 });
    await worker.start(kit.context);
    await vi.waitFor(() => expect(kit.since).toHaveBeenCalled());
    leaving.abort();
    await pause(20);
    const polls = kit.since.mock.calls.length;
    await pause(80);
    expect(kit.since.mock.calls.length).toBe(polls);
    await worker.stop(Temporal.Now.instant());
  });
});
