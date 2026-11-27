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
    await vi.waitFor(() => expect(r.loads()).toBe(2));
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
    // The load the caller joined began this very moment, so no further load is made for it.
    expect(r.loads()).toBe(2);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(10));
    r.stop();
  });

  test('a request that joins a load that began a bound ago waits for one more load and is served the change, with no wake', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.advance(1000);
    // A load begins and reads the rows as they stand, and does not end yet.
    r.holdAfterRead(true);
    const began = r.cache.fresh();
    await vi.waitFor(() => expect(r.loads()).toBe(2));
    r.holdAfterRead(false);
    // The change is stored, a bound passes, and a request joins the load that is still open.
    r.set([storedQuotaRow('notes.rows', '10', { version: 2 })]);
    r.advance(1000);
    const joined = r.cache.fresh();
    r.release();
    await Promise.all([began, joined]);
    // The load is dated by its start, a bound old: the joined request waits for a third load.
    expect(r.loads()).toBe(3);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(10));
    r.stop();
  });

  test('two requests that join the same old load are both served the new limit, though the further load is still running when the first of them has started it', async () => {
    const turns = async (count: number): Promise<void> => {
      for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
    };
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.advance(1000);
    r.holdAfterRead(true);
    const began = r.cache.fresh();
    await vi.waitFor(() => expect(r.loads()).toBe(2));
    r.holdAfterRead(false);
    r.set([storedQuotaRow('notes.rows', '10', { version: 2 })]);
    r.advance(1000);
    // Both join the load that read the old rows; the load after it is held at the barrier.
    const served: unknown[] = [];
    const answer = async (): Promise<void> => {
      await r.cache.fresh();
      served.push(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows'));
    };
    const first = answer();
    const second = answer();
    r.hold(true);
    r.release();
    await vi.waitFor(() => expect(r.loads()).toBe(3));
    await turns(100);
    // Neither is answered while the further load runs, and neither was given the old rows.
    expect(served).toEqual([]);
    r.hold(false);
    r.release();
    await Promise.all([began, first, second]);
    expect(r.loads()).toBe(3);
    expect(served).toEqual([count(10), count(10)]);
    r.stop();
  });

  test('a request that began its own load is not given a further load when that load ran for a bound', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.advance(1000);
    r.hold(true);
    const own = r.cache.fresh();
    await vi.waitFor(() => expect(r.loads()).toBe(2));
    r.advance(1000);
    r.hold(false);
    r.release();
    await own;
    expect(r.loads()).toBe(2);
    r.stop();
  });

  test('a request that joins a load that fails is not given a further load', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
    await r.cache.fresh();
    r.advance(1000);
    r.hold(true);
    const began = r.cache.fresh();
    await vi.waitFor(() => expect(r.loads()).toBe(2));
    r.fail(true);
    r.advance(1000);
    const joined = r.cache.fresh();
    r.hold(false);
    r.release();
    await Promise.all([began, joined]);
    expect(r.loads()).toBe(2);
    expect(r.cache.limitOf(registry, quotaTenantScope, 'notes.rows')).toEqual(count(40));
    r.stop();
  });

  test('a request whose wait for a load that is still running ends at the read bound is not given a further wait', async () => {
    const turns = async (count: number): Promise<void> => {
      for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
    };
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      timeouts.push(controller);
      return controller.signal;
    });
    try {
      const r = quotaRig([storedQuotaRow('notes.rows', '40')]);
      await r.cache.fresh();
      r.advance(1000);
      r.hold(true);
      const began = r.cache.fresh();
      await vi.waitFor(() => expect(r.loads()).toBe(2));
      r.advance(1000);
      let answered = false;
      const joined = r.cache.fresh().then(() => {
        answered = true;
      });
      await turns(100);
      expect(answered).toBe(false);
      // The read bound of this caller's wait runs out while the load is still held (its own read
      // bound, the newest signal made, is not the load's).
      timeouts.at(-1)?.abort(new DOMException('slow', 'TimeoutError'));
      await turns(100);
      expect(answered).toBe(true);
      expect(r.loads()).toBe(2);
      r.hold(false);
      r.release();
      await Promise.all([began, joined]);
      r.stop();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('firstLoad loads once and starts the feed; it rejects with the error of a read that failed', async () => {
    const r = quotaRig([storedQuotaRow('notes.rows', '30')]);
    await r.cache.firstLoad();
    expect(r.loads()).toBe(1);
    await vi.waitFor(() => expect(r.subscribes()).toBe(1));
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
      await vi.waitFor(() => expect(r.loads()).toBe(1));
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
