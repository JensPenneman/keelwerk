import type { ChangeFeedSource, NamespaceRef, Position } from '@keelwerk/core';
import type { PollChangeFeedOptions } from './poll-change-feed-options.ts';

type Wake = { readonly namespace: string; readonly scopeIds: readonly string[] };

/**
 * The generic polling feed (14.3.3, 15.2.5): every interval it asks `movedScopes` which scopes of
 * each wanted namespace gained events since the marks it holds, and wakes with them. The marks
 * start empty, so the first wake-up of a namespace names every scope that has events: the feed
 * cannot know what the reader has read, and a commit between the reader's first read and a later
 * baseline would otherwise be lost. A poll that fails is reported and repeated, which costs
 * latency and never an event.
 */
export function pollChangeFeed(options: PollChangeFeedOptions): ChangeFeedSource {
  const intervalMs = options.intervalMs ?? 1000;
  const pageSize = options.pageSize ?? 1000;
  const sweep = async (
    namespace: NamespaceRef,
    marks: Map<string, Position>,
  ): Promise<readonly string[]> => {
    const moved: string[] = [];
    try {
      for (;;) {
        const page = await options.moved(namespace, marks, pageSize);
        for (const entry of page) {
          marks.set(entry.scopeId, entry.head);
          moved.push(entry.scopeId);
        }
        if (page.length < pageSize) break;
      }
    } catch (error) {
      options.onError?.(namespace, error);
    }
    return moved;
  };
  return {
    level: 'poll',
    async *wake(namespaces: readonly NamespaceRef[], signal: AbortSignal): AsyncGenerator<Wake> {
      const marks = new Map(
        namespaces.map((namespace) => [namespace.id, new Map<string, Position>()]),
      );
      const marksOf = (namespace: NamespaceRef): Map<string, Position> =>
        marks.get(namespace.id) ?? new Map();
      while (!signal.aborted) {
        for (const namespace of namespaces) {
          if (signal.aborted) return;
          const moved = await sweep(namespace, marksOf(namespace));
          if (moved.length > 0) yield { namespace: namespace.id, scopeIds: moved };
        }
        await options.sleep(intervalMs, signal);
      }
    },
  };
}
