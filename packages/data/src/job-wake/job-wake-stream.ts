import type { JobWake } from '@keelwerk/core';

/** The wake-ups of one reader of a jobs feed, and the way an adapter feeds it. */
export interface JobWakeStream {
  /**
   * A commit made jobs takeable in `queues` of `namespace`, or in queues it cannot name. Wake-ups of
   * a namespace that the reader waits for merge until it reads: the union of the queues, and one that
   * names none absorbs the rest. Other namespaces are ignored.
   */
  push(namespace: string, queues: readonly string[] | undefined): void;
  /** Ends when `signal` aborts. */
  readonly wakes: AsyncGenerator<JobWake>;
}

/**
 * The reader side of `ChangeFeedSource.jobs` (15.2.5), shared by every adapter. Each namespace starts
 * with a pending wake-up that names no queues: the reader cannot know what committed before it
 * listened.
 */
export function jobWakeStream(namespaces: readonly string[], signal: AbortSignal): JobWakeStream {
  const pending = new Map<string, Set<string> | undefined>(
    namespaces.map((namespace) => [namespace, undefined]),
  );
  const wanted = new Set(namespaces);
  let wakeUp: (() => void) | undefined;
  return {
    push: (namespace, queues) => {
      if (!wanted.has(namespace)) return;
      const known = pending.get(namespace);
      if (pending.has(namespace) && known === undefined) return;
      if (queues === undefined) {
        pending.set(namespace, undefined);
      } else {
        const merged = known ?? new Set<string>();
        for (const queue of queues) merged.add(queue);
        pending.set(namespace, merged);
      }
      wakeUp?.();
    },
    wakes: (async function* () {
      while (!signal.aborted) {
        if (pending.size === 0) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
              signal.removeEventListener('abort', done);
              wakeUp = undefined;
              resolve();
            };
            wakeUp = done;
            signal.addEventListener('abort', done, { once: true });
          });
          continue;
        }
        const batch = [...pending];
        pending.clear();
        for (const [namespace, queues] of batch) {
          yield queues === undefined ? { namespace } : { namespace, queues: [...queues] };
        }
      }
    })(),
  };
}
