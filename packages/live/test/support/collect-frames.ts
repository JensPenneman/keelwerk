import type { KeelwerkError, LiveFrame } from '@keelwerk/core';

/** What a followed stream was given, and how to wait for more. */
export interface CollectedFrames<T = unknown> {
  readonly frames: LiveFrame<T>[];
  /** The error `next()` threw, when it did. */
  failure(): KeelwerkError | undefined;
  ended(): boolean;
  until(test: (frames: readonly LiveFrame<T>[]) => boolean, ms?: number): Promise<void>;
  /** Waits for the `head` frame: everything written later reaches the stream. */
  ready(): Promise<void>;
  stop(): Promise<void>;
}

/** Reads a stream in the background and keeps its frames. */
export function collectFrames<T>(iterable: AsyncIterable<LiveFrame<T>>): CollectedFrames<T> {
  const frames: LiveFrame<T>[] = [];
  const iterator = iterable[Symbol.asyncIterator]();
  let failure: KeelwerkError | undefined;
  let done = false;
  let wake: (() => void) | undefined;
  void (async () => {
    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done === true) break;
        frames.push(step.value);
        wake?.();
      }
    } catch (error) {
      failure = error as KeelwerkError;
    } finally {
      done = true;
      wake?.();
    }
  })();
  const collected: CollectedFrames<T> = {
    frames,
    failure: () => failure,
    ended: () => done,
    ready: () => collected.until((got) => got.some((frame) => 'control' in frame)),
    until: async (test, ms = 15_000) => {
      const deadline = Date.now() + ms;
      while (!test(frames)) {
        if (done) {
          if (test(frames)) return;
          throw new Error(
            `the stream ended before the frames matched (${failure?.code ?? 'no error'}): ${JSON.stringify(frames, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}`,
          );
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          throw new Error(`timed out; the frames so far: ${JSON.stringify(frames)}`);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(left, 100));
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    },
    stop: async () => {
      await iterator.return?.();
    },
  };
  return collected;
}
