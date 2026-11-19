import type { LiveFrame } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { settleEffects } from '../../src/settle-effects.ts';

interface Status {
  readonly id: string;
  readonly status: 'requested' | 'succeeded' | 'failed';
}

/** A controllable watch: the test pushes frames into the watch of one group. */
function watches() {
  const opened: {
    ids: readonly string[];
    push(frame: LiveFrame<Status>): void;
    closed: boolean;
  }[] = [];
  const watch = (ids: readonly string[]): AsyncIterable<LiveFrame<Status>> => {
    const queue: LiveFrame<Status>[] = [];
    let wake: (() => void) | undefined;
    const entry = {
      ids,
      closed: false,
      push(frame: LiveFrame<Status>) {
        queue.push(frame);
        wake?.();
      },
    };
    opened.push(entry);
    const iterator: AsyncIterator<LiveFrame<Status>> = {
      async next() {
        for (;;) {
          const next = queue.shift();
          if (next !== undefined) return { done: false, value: next };
          if (entry.closed) return { done: true, value: undefined };
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
      async return() {
        entry.closed = true;
        wake?.();
        return { done: true, value: undefined };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  };
  return { opened, watch };
}

const head: LiveFrame<Status> = { control: 'head', state: 'v2.0.1.00000000.0' as never };
const status = (id: string, state: Status['status']): LiveFrame<Status> => ({
  event: { id, status: state },
});

describe('settleEffects', () => {
  it('starts no watch for no ids', async () => {
    const { opened, watch } = watches();
    expect(await settleEffects(watch, [], {})).toEqual({
      statuses: [],
      missing: [],
      settled: true,
    });
    expect(opened).toHaveLength(0);
  });

  it('returns the statuses in the order of the ids once all are settled, and closes the watch', async () => {
    const { opened, watch } = watches();
    const done = settleEffects(watch, ['a', 'b', 'a'], {});
    const only = opened[0];
    only?.push(status('b', 'requested'));
    only?.push(status('a', 'requested'));
    only?.push(head);
    only?.push(status('b', 'succeeded'));
    only?.push(status('a', 'failed'));
    expect(await done).toEqual({
      statuses: [
        { id: 'a', status: 'failed' },
        { id: 'b', status: 'succeeded' },
      ],
      missing: [],
      settled: true,
    });
    expect(only?.closed).toBe(true);
  });

  it('makes two watches for 150 ids, and waits for both', async () => {
    const { opened, watch } = watches();
    const ids = Array.from({ length: 150 }, (_, index) => `e${index}`);
    const done = settleEffects(watch, ids, {});
    expect(opened.map((entry) => entry.ids.length)).toEqual([100, 50]);
    for (const entry of opened) {
      for (const id of entry.ids) entry.push(status(id, 'succeeded'));
      entry.push(head);
    }
    const result = await done;
    expect(result.statuses).toHaveLength(150);
    expect(result.settled).toBe(true);
    expect(opened.every((entry) => entry.closed)).toBe(true);
  });

  it('reports the ids missing at the first head and closes every watch', async () => {
    const { opened, watch } = watches();
    const ids = Array.from({ length: 101 }, (_, index) => `e${index}`);
    const done = settleEffects(watch, ids, {});
    opened[0]?.push(status('e0', 'requested'));
    opened[0]?.push(head);
    const result = await done;
    expect(result.missing).toHaveLength(99);
    expect(result.missing).not.toContain('e0');
    expect(result.settled).toBe(false);
    expect(opened.every((entry) => entry.closed)).toBe(true);
  });

  it('clears a watch on a reset and counts the missing again at the next head', async () => {
    const { opened, watch } = watches();
    const done = settleEffects(watch, ['a'], {});
    const only = opened[0];
    only?.push(status('a', 'requested'));
    only?.push({ control: 'reset', reason: 'resync' });
    only?.push(head);
    const result = await done;
    expect(result.missing).toEqual(['a']);
    expect(result.statuses).toEqual([]);
  });

  it('resolves at the timeout with the statuses as they stand', async () => {
    const { opened, watch } = watches();
    const done = settleEffects(watch, ['a', 'b'], { timeoutMs: 20 });
    opened[0]?.push(status('a', 'requested'));
    opened[0]?.push(status('b', 'succeeded'));
    opened[0]?.push(head);
    expect(await done).toEqual({
      statuses: [
        { id: 'a', status: 'requested' },
        { id: 'b', status: 'succeeded' },
      ],
      missing: [],
      settled: false,
    });
    expect(opened[0]?.closed).toBe(true);
  });

  it('rejects with the abort reason and with a watch that fails, closing the watches first', async () => {
    const aborted = watches();
    const controller = new AbortController();
    const first = settleEffects(aborted.watch, ['a'], { signal: controller.signal });
    controller.abort(new Error('stop'));
    await expect(first).rejects.toThrow('stop');
    expect(aborted.opened[0]?.closed).toBe(true);
    const failing = (): AsyncIterable<LiveFrame<Status>> => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('watch broke')) }),
    });
    await expect(settleEffects(failing, ['a'], {})).rejects.toThrow('watch broke');
  });
});
