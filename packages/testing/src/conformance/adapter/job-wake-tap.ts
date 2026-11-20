import type { ChangeFeedSource, JobWake } from '@keelwerk/core';

/** A reader of `feed.jobs` that the test watches without taking anything from it. */
export interface JobWakeTap {
  /** `feed.jobs`, observed: hand it to the reader under test. */
  readonly jobs: ChangeFeedSource['jobs'];
  /** The next wake-up the reader received that no call of `next` has answered yet. */
  next(): Promise<JobWake>;
  /** Settles when the reader asked for another wake-up after the last one it received: it acted on all it got. */
  processed(): Promise<void>;
}

/** Observes the readers of `feed.jobs`: what they receive, and when they ask for more. */
export function tapJobWakes(feed: Pick<ChangeFeedSource, 'jobs'>): JobWakeTap {
  const received: JobWake[] = [];
  const watchers = new Set<() => void>();
  let answered = 0;
  let asked = 0;
  const changed = (): void => {
    for (const watcher of [...watchers]) watcher();
  };
  const until = (done: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (!done()) return;
        watchers.delete(check);
        resolve();
      };
      watchers.add(check);
      check();
    });
  return {
    jobs: (namespaces, signal) => ({
      [Symbol.asyncIterator]: () => {
        const inner = feed.jobs(namespaces, signal)[Symbol.asyncIterator]();
        return {
          next: async () => {
            asked += 1;
            changed();
            const result = await inner.next();
            if (result.done !== true) {
              received.push(result.value);
              changed();
            }
            return result;
          },
          return: async () => inner.return?.() ?? { done: true, value: undefined },
        };
      },
    }),
    next: async () => {
      await until(() => received.length > answered);
      const wake = received[answered];
      if (wake === undefined) throw new Error('a wake-up was received and is gone');
      answered += 1;
      return wake;
    },
    processed: () => until(() => asked === received.length + 1),
  };
}
