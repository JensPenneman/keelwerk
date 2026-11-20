import type { ChangeFeedSource, NamespaceRef } from '@keelwerk/core';
import type { JobWakeStream } from '../job-wake/job-wake-stream.ts';
import { jobWakeStream } from '../job-wake/job-wake-stream.ts';

interface Reader {
  readonly namespaces: ReadonlySet<string>;
  readonly pending: Map<string, Set<string>>;
  notify: (() => void) | undefined;
}

/** The feed and the way the adapter wakes it. */
export interface PgliteChangeFeed {
  readonly source: ChangeFeedSource;
  /** Wakes every reader of `namespace`; the adapter calls it after a unit committed. */
  publish(namespace: string, scopeIds: readonly string[]): void;
  /** Wakes the readers of the workers' feed after a unit committed; no `queues` means every queue. */
  readied(namespace: string, queues: readonly string[] | undefined): void;
}

/**
 * The in-process change feed (section 15.2.5): wake-ups after commit, never data. Several
 * publications between two reads of one reader merge into one wake-up per namespace, as the 50
 * millisecond window of the notifier does on PostgreSQL. Each feed keeps its own readers.
 */
export function pgliteChangeFeed(): PgliteChangeFeed {
  const readers = new Set<Reader>();
  const jobReaders = new Set<JobWakeStream>();
  const source: ChangeFeedSource = {
    level: 'notify',
    async *wake(
      namespaces: readonly NamespaceRef[],
      signal: AbortSignal,
    ): AsyncGenerator<{ readonly namespace: string; readonly scopeIds: readonly string[] }> {
      const reader: Reader = {
        namespaces: new Set(namespaces.map((namespace) => namespace.id)),
        pending: new Map(),
        notify: undefined,
      };
      readers.add(reader);
      try {
        while (!signal.aborted) {
          if (reader.pending.size === 0) {
            await new Promise<void>((resolve) => {
              const done = (): void => {
                signal.removeEventListener('abort', done);
                reader.notify = undefined;
                resolve();
              };
              reader.notify = done;
              signal.addEventListener('abort', done, { once: true });
            });
            continue;
          }
          const batch = [...reader.pending];
          reader.pending.clear();
          for (const [namespace, scopeIds] of batch) yield { namespace, scopeIds: [...scopeIds] };
        }
      } finally {
        readers.delete(reader);
      }
    },
    async *jobs(namespaces, signal) {
      const stream = jobWakeStream(
        namespaces.map((namespace) => namespace.id),
        signal,
      );
      jobReaders.add(stream);
      try {
        yield* stream.wakes;
      } finally {
        jobReaders.delete(stream);
      }
    },
  };
  return {
    source,
    publish(namespace: string, scopeIds: readonly string[]): void {
      for (const reader of readers) {
        if (!reader.namespaces.has(namespace)) continue;
        const known = reader.pending.get(namespace) ?? new Set<string>();
        for (const id of scopeIds) known.add(id);
        reader.pending.set(namespace, known);
        reader.notify?.();
      }
    },
    readied(namespace: string, queues: readonly string[] | undefined): void {
      for (const reader of jobReaders) reader.push(namespace, queues);
    },
  };
}
