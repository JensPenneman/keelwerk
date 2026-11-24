import type { LiveFrame } from '@keelwerk/core';
import type { EffectSettling } from './effect-settling.ts';

/** The largest number of ids one `core.effectStatusWatch` takes. */
const watchSize = 100;

interface Watch<T> {
  readonly group: readonly string[];
  readonly statuses: Map<string, T>;
  readonly iterator: AsyncIterator<LiveFrame<T>>;
  head: boolean;
  missing: readonly string[];
}

/**
 * Waits on `core.effectStatusWatch` frames: the distinct ids are watched 100 to a watch, the watches
 * in parallel. At a watch's first `head` the ids it has no status for are missing, and the call then
 * returns with them (every watch closed); a `reset` clears that watch's statuses and the next `head`
 * counts again. It returns when every found status is settled, or at `timeoutMs` with what stands.
 * Empty ids start no watch. It rejects with a watch's error or the reason the signal aborted with;
 * every watch is closed (`return()`) before it settles.
 */
export function settleEffects<T extends { readonly id: string; readonly status: string }>(
  watch: (ids: readonly string[]) => AsyncIterable<LiveFrame<T>>,
  ids: readonly string[],
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<EffectSettling<T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return Promise.resolve({ statuses: [], missing: [], settled: true });
  if (options.signal?.aborted === true) return Promise.reject(options.signal.reason);
  const groups: string[][] = [];
  for (let at = 0; at < unique.length; at += watchSize)
    groups.push(unique.slice(at, at + watchSize));
  const watches: Watch<T>[] = groups.map((group) => ({
    group,
    statuses: new Map(),
    iterator: watch(group)[Symbol.asyncIterator](),
    head: false,
    missing: [],
  }));
  return new Promise((resolve, reject) => {
    let over = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const snapshot = (): EffectSettling<T> => {
      const found = new Map(watches.flatMap((entry) => [...entry.statuses]));
      const statuses = unique.flatMap((id) => {
        const status = found.get(id);
        return status === undefined ? [] : [status];
      });
      return {
        statuses,
        missing: watches.flatMap((entry) => entry.missing),
        settled:
          watches.every((entry) => entry.head) &&
          statuses.every((status) => status.status !== 'requested'),
      };
    };
    const conclude = (outcome: () => void): void => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      void Promise.all(
        watches.map((entry) =>
          Promise.resolve(entry.iterator.return?.(undefined)).catch(() => undefined),
        ),
      ).then(outcome);
    };
    const onAbort = (): void => {
      const reason: unknown = options.signal?.reason;
      conclude(() => reject(reason));
    };
    const evaluate = (): void => {
      if (watches.some((entry) => entry.missing.length > 0)) {
        const result = snapshot();
        conclude(() => resolve(result));
        return;
      }
      const result = snapshot();
      if (result.settled) conclude(() => resolve(result));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        const result = snapshot();
        conclude(() => resolve(result));
      }, options.timeoutMs);
    }
    const pump = async (entry: Watch<T>): Promise<void> => {
      try {
        for (;;) {
          const step = await entry.iterator.next();
          if (over) return;
          if (step.done === true) {
            const result = snapshot();
            conclude(() => resolve(result));
            return;
          }
          const frame = step.value;
          if ('control' in frame) {
            if (frame.control === 'head' && !entry.head) {
              entry.head = true;
              entry.missing = entry.group.filter((id) => !entry.statuses.has(id));
            } else if (frame.control === 'reset') {
              entry.statuses.clear();
              entry.head = false;
              entry.missing = [];
            }
          } else {
            entry.statuses.set(frame.event.id, frame.event);
          }
          evaluate();
          if (over) return;
        }
      } catch (failure) {
        conclude(() => reject(failure));
      }
    };
    for (const entry of watches) void pump(entry);
  });
}
