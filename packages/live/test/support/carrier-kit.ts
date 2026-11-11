import type {
  CarrierConnection,
  CarrierEndReason,
  CarrierOptions,
  LiveFrame,
  WireError,
} from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');

export type Sse = Extract<CarrierConnection, { readonly kind: 'sse' }>;

/** A connection that keeps what it was written and how it ended. */
export function fakeConnection(): {
  readonly connection: Sse;
  readonly written: string[];
  readonly ends: (CarrierEndReason | 'error')[];
  readonly abort: () => void;
  readonly failed: WireError[];
} {
  const written: string[] = [];
  const ends: (CarrierEndReason | 'error')[] = [];
  const failed: WireError[] = [];
  const controller = new AbortController();
  const connection: Sse = {
    kind: 'sse',
    lastEventId: null,
    signal: controller.signal,
    write: async (chunk) => {
      written.push(chunk);
    },
    end: async (reason) => {
      ends.push(reason);
    },
    fail: async (error) => {
      failed.push(error);
      ends.push('error');
    },
  };
  return { connection, written, ends, abort: () => controller.abort(), failed };
}

export const options: CarrierOptions = {
  heartbeatMs: 10_000,
  maxBufferedItems: 1000,
  maxBufferedBytes: 1_048_576,
  maxDurationMs: 60_000,
  welcome: { apiVersion: '2026-11-11', surfaceHash: 'sha256-x', protocol: 1 },
};

/** A clock the test moves, and the timers that fire only when the test says so. */
export function pinned() {
  let now = start;
  const clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const kitOptions: CarrierOptions = {
    ...options,
    heartbeatMs: 15_000,
    maxDurationMs: 60_000,
    clock,
    timers,
  };
  return {
    timers,
    options: kitOptions,
    /** Moves the clock to `ms` after the start, fires what is due and answers how many waits fired. */
    at: (ms: number) => {
      now = start.add({ milliseconds: ms });
      return timers.fire();
    },
  };
}

/** A stream the test feeds frame by frame, which records whether it was returned. */
export function fedStream() {
  const waiting: ((result: IteratorResult<LiveFrame<unknown>>) => void)[] = [];
  const queued: LiveFrame<unknown>[] = [];
  const state = { returned: false };
  const stream: AsyncIterable<LiveFrame<unknown>> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const frame = queued.shift();
        if (frame !== undefined) return Promise.resolve({ done: false, value: frame });
        return new Promise<IteratorResult<LiveFrame<unknown>>>((resolve) => waiting.push(resolve));
      },
      return: async () => {
        state.returned = true;
        return { done: true, value: undefined };
      },
    }),
  };
  return {
    stream,
    state,
    feed: (frame: LiveFrame<unknown>) => {
      const next = waiting.shift();
      if (next === undefined) queued.push(frame);
      else next({ done: false, value: frame });
    },
    finish: () => {
      for (const next of waiting.splice(0)) next({ done: true, value: undefined });
    },
  };
}

/** A stream of the frames given that records whether it was returned. */
export function streamOf(
  frames: readonly LiveFrame<unknown>[],
  then: 'end' | 'hang' | Error = 'end',
) {
  const state = { returned: false };
  const stream: AsyncIterable<LiveFrame<unknown>> = {
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: async () => {
          const frame = frames[index];
          if (frame !== undefined) {
            index += 1;
            return { done: false, value: frame };
          }
          if (then instanceof Error) throw then;
          if (then === 'hang') await new Promise(() => undefined);
          return { done: true, value: undefined };
        },
        return: async () => {
          state.returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { stream, state };
}
