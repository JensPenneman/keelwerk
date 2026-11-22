import { describe, expect, test, vi } from 'vitest';
import {
  notesQuota,
  quotaRig,
  quotaTenantScope,
  registryOf,
  storedQuotaRow,
} from '../../test/quota-cache-kit.ts';

// How the cache loads and follows the feed: after a failed read, with a load in flight, at the
// start (`firstLoad`) and when the feed fails. What decides each case: the number of reads of the
// store and of subscriptions to the feed, and the limit the cache answers; the clock is pinned and
// the timers of the pauses are faked, so nothing waits for time to pass.

const registry = registryOf(notesQuota);
const count = (value: number) => ({ kind: 'count', value });

describe('createQuotaCache loading', () => {
  test('a read that fails keeps the last rows, and the next read that succeeds brings the new ones', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.set([storedQuotaRow('notes.rows', '10', { version: 2 })]);
    r.fail(true);
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.loads()).toBe(2);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    r.fail(false);
    r.advance(1_000);
    await r.cache.fresh();
    expect(r.loads()).toBe(3);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(10));
    r.stop();
  });

  test('fresh() with aged rows waits for the load in flight and answers its rows', async () => {
    const turns = async (count: number): Promise<void> => {
      for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
    };
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.set([storedQuotaRow('notes.rows', '10', { version: 2 })]);
    r.advance(1_000);
    r.hold(true);
    const starter = r.cache.fresh();
    await vi.waitFor(() => expect(r.loads()).toBe(2), { timeout: 10_000 });
    // The rows are aged and a load is in flight, its read held at the barrier: the caller waits.
    let answered = false;
    const caller = r.cache.fresh().then(() => {
      answered = true;
    });
    await turns(100);
    expect(answered).toBe(false);
    expect(r.loads()).toBe(2);
    r.hold(false);
    r.release();
    await Promise.all([starter, caller]);
    expect(answered).toBe(true);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(10));
    r.stop();
  });

  test('firstLoad loads once and starts the feed; it rejects with the error of a read that failed', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '30')]);
    await r.cache.firstLoad();
    expect(r.loads()).toBe(1);
    await vi.waitFor(() => expect(r.subscribes()).toBe(1), { timeout: 10_000 });
    r.stop();
    const down = quotaRig([storedQuotaRow('notes.rows', '30')]);
    down.fail(true);
    await expect(down.cache.firstLoad()).rejects.toThrow('control store down');
    down.fail(false);
    await down.cache.firstLoad();
    await down.cache.fresh();
    expect(down.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(30));
    down.stop();
  });

  test('firstLoad rejects with core.unavailable when the read does not end within the bound', async () => {
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      timeouts.push(controller);
      return controller.signal;
    });
    try {
      const r = quotaRig([storedQuotaRow('notes.rows', '30')]);
      r.hold(true);
      const first = r.cache.firstLoad();
      const refused = expect(first).rejects.toMatchObject({ kind: 'unavailable' });
      await vi.waitFor(() => expect(r.loads()).toBe(1), { timeout: 10_000 });
      for (const timeout of timeouts) timeout.abort(new DOMException('slow', 'TimeoutError'));
      await refused;
      r.hold(false);
      r.release();
      r.stop();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('a feed that fails is subscribed again by the pauses of the background loops, and a wake starts the count again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const r = quotaRig([storedQuotaRow('notes.rows', '30')]);
      r.feed('fail');
      await r.cache.fresh();
      expect(r.subscribes()).toBe(1);
      // 1, 2, 4, 8, 10 and 10 seconds: the one policy (`backgroundRetryMs`), not a pause of its own.
      let seen = 1;
      let at = 0;
      for (const pause of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]) {
        await vi.advanceTimersByTimeAsync(pause - 1);
        expect(r.subscribes(), `${at + pause - 1} ms`).toBe(seen);
        await vi.advanceTimersByTimeAsync(1);
        seen += 1;
        at += pause;
        expect(r.subscribes(), `${at} ms`).toBe(seen);
      }
      // A wake is a success: the next pause is the first again.
      r.feed('wake-then-end');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(r.subscribes()).toBe(seen + 1);
      await vi.advanceTimersByTimeAsync(999);
      expect(r.subscribes()).toBe(seen + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(r.subscribes()).toBe(seen + 2);
      r.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
