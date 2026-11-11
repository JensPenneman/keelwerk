import type { KeelwerkError, LiveFrame, StateToken } from '@keelwerk/core';
import { frameBytes } from './frame-bytes.ts';

function stateOf(frame: LiveFrame<unknown>): StateToken | undefined {
  return 'state' in frame ? frame.state : undefined;
}

/**
 * What one subscriber has not taken yet (15.4.5): bounded in items and in bytes, both counted over
 * every queued frame, control frames included. Bytes are counted when a frame is queued and
 * released when `next` returns it.
 */
export interface SubscriptionBuffer {
  /** Queues a frame; false when it would overflow a limit (nothing is queued). A frame that alone exceeds the byte limit is accepted into an empty buffer. */
  push(frame: LiveFrame<unknown>): boolean;
  /** Drops everything queued and queues `frame` as the last frame: the stream ends after it. */
  replaceWith(frame: LiveFrame<unknown>): void;
  /** No more frames come: `next` ends the stream once the queued ones are taken. */
  finish(): void;
  /** Drops everything queued: `next` throws `error`. */
  fail(error: KeelwerkError): void;
  /** Drops everything queued and ends the stream. */
  close(): void;
  next(): Promise<IteratorResult<LiveFrame<unknown>>>;
  /** The state of the last frame `next` returned that carried one; undefined when none did. */
  readonly lastDelivered: StateToken | undefined;
  readonly items: number;
  readonly bytes: number;
  /** Resolves when the buffer is under half of both limits (at once when it is), or has ended. */
  whenBelowHalf(): Promise<void>;
}

/** A buffer that holds `maxItems` frames and `maxBytes` bytes at most. */
export function createSubscriptionBuffer(limits: {
  readonly maxItems: number;
  readonly maxBytes: number;
}): SubscriptionBuffer {
  const queue: { readonly frame: LiveFrame<unknown>; readonly bytes: number }[] = [];
  let bytes = 0;
  let last: StateToken | undefined;
  let finished = false;
  let failure: KeelwerkError | undefined;
  let waiting: ((step: IteratorResult<LiveFrame<unknown>>) => void) | undefined;
  let failing: ((error: KeelwerkError) => void) | undefined;
  let below: (() => void)[] = [];

  const underHalf = (): boolean =>
    queue.length * 2 <= limits.maxItems && bytes * 2 <= limits.maxBytes;
  const settleBelow = (): void => {
    if (!(underHalf() || finished || failure !== undefined)) return;
    const ready = below;
    below = [];
    for (const resolve of ready) resolve();
  };
  const take = (frame: LiveFrame<unknown>): IteratorResult<LiveFrame<unknown>> => {
    const state = stateOf(frame);
    if (state !== undefined) last = state;
    return { done: false, value: frame };
  };
  const clear = (): void => {
    queue.length = 0;
    bytes = 0;
  };

  return {
    push: (frame) => {
      if (finished || failure !== undefined) return true;
      const size = frameBytes(frame);
      if (waiting !== undefined) {
        const resolve = waiting;
        waiting = undefined;
        failing = undefined;
        resolve(take(frame));
        return true;
      }
      if (
        queue.length > 0 &&
        (queue.length + 1 > limits.maxItems || bytes + size > limits.maxBytes)
      ) {
        return false;
      }
      queue.push({ frame, bytes: size });
      bytes += size;
      return true;
    },
    replaceWith: (frame) => {
      clear();
      finished = true;
      if (waiting !== undefined) {
        const resolve = waiting;
        waiting = undefined;
        failing = undefined;
        resolve(take(frame));
        return;
      }
      queue.push({ frame, bytes: frameBytes(frame) });
      bytes = queue[0]?.bytes ?? 0;
      settleBelow();
    },
    finish: () => {
      finished = true;
      if (waiting !== undefined && queue.length === 0) {
        const resolve = waiting;
        waiting = undefined;
        failing = undefined;
        resolve({ done: true, value: undefined });
      }
      settleBelow();
    },
    fail: (error) => {
      clear();
      if (failing !== undefined) {
        const reject = failing;
        waiting = undefined;
        failing = undefined;
        finished = true;
        reject(error);
      } else {
        failure = error;
      }
      settleBelow();
    },
    close: () => {
      clear();
      finished = true;
      if (waiting !== undefined) {
        const resolve = waiting;
        waiting = undefined;
        failing = undefined;
        resolve({ done: true, value: undefined });
      }
      settleBelow();
    },
    next: () => {
      const [head] = queue;
      if (head !== undefined) {
        queue.shift();
        bytes -= head.bytes;
        settleBelow();
        return Promise.resolve(take(head.frame));
      }
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        finished = true;
        return Promise.reject(error);
      }
      if (finished) return Promise.resolve({ done: true, value: undefined });
      return new Promise<IteratorResult<LiveFrame<unknown>>>((resolve, reject) => {
        waiting = resolve;
        failing = reject;
      });
    },
    get lastDelivered() {
      return last;
    },
    get items() {
      return queue.length;
    },
    get bytes() {
      return bytes;
    },
    whenBelowHalf: () =>
      underHalf() || finished || failure !== undefined
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            below.push(resolve);
          }),
  };
}
