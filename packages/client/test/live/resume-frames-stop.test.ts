import type { WireError } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import type { LiveLeg } from '../../src/live-leg.ts';
import type { LiveLegEvent } from '../../src/live-leg-event.ts';
import { resumeFrames } from '../../src/resume-frames.ts';

const options = {
  retry: {
    retries: 2,
    baseDelayMs: 1,
    maxDelayMs: 1,
    random: () => 0.5,
    sleep: () => Promise.resolve(),
  },
  dropped: () => true,
  failure: (error: WireError) => new Error(`wire ${error.code}`),
};

describe('resumeFrames at the stop', () => {
  it('closes a connection that arrives after the stop', async () => {
    const late = Promise.withResolvers<AsyncIterable<LiveLegEvent>>();
    let returned = false;
    const controller = new AbortController();
    const iterator = resumeFrames(
      () => late.promise,
      { action: 'x.y' },
      { ...options, signal: controller.signal },
    )[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
    late.resolve({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
        return: () => {
          returned = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    });
    await late.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(returned).toBe(true);
  });

  it('ends a pending next() at the stop, though the connection never answers', async () => {
    const stalled: LiveLeg = async () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<LiveLegEvent>>(() => undefined),
        return: () => Promise.resolve({ done: true, value: undefined }),
      }),
    });
    const controller = new AbortController();
    const iterator = resumeFrames(
      stalled,
      { action: 'x.y' },
      { ...options, signal: controller.signal },
    )[Symbol.asyncIterator]();
    const pending = iterator.next();
    // Let the connection open and the read begin, then stop.
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    const verdict = await Promise.race([
      pending,
      new Promise<'pending'>((resolve) => setImmediate(() => resolve('pending'))),
    ]);
    expect(verdict).toEqual({ done: true, value: undefined });
  });
});
