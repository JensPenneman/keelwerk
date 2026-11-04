import type { ChangeFeedSource } from '@keelwerk/core';
import type { MemoryDatabase } from './memory-database.ts';

/**
 * The in-process feed (15.2.5): a wake-up names the namespace and scopes that committed events,
 * never data. The listener is registered when `wake` is called, so a commit between the call and
 * the first read is not lost; wake-ups of one burst are merged, and the iterator ends (and the
 * listener goes) when its signal aborts.
 */
export function memoryChangeFeed(database: MemoryDatabase): ChangeFeedSource {
  return {
    level: 'notify',
    wake: (namespaces, signal) => {
      const wanted = new Set(namespaces.map((namespace) => namespace.id));
      const pending = new Map<string, Set<string>>();
      let wakeUp: (() => void) | undefined;
      const stop = database.listen((namespaceId, scopeId) => {
        if (!wanted.has(namespaceId)) return;
        const scopes = pending.get(namespaceId) ?? new Set<string>();
        scopes.add(scopeId);
        pending.set(namespaceId, scopes);
        wakeUp?.();
      });
      const onAbort = (): void => {
        stop();
        wakeUp?.();
      };
      signal.addEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
      return (async function* () {
        try {
          while (!signal.aborted) {
            if (pending.size === 0) {
              await new Promise<void>((resolve) => {
                wakeUp = resolve;
              });
              wakeUp = undefined;
              continue;
            }
            const batch = [...pending];
            pending.clear();
            for (const [namespace, scopes] of batch) yield { namespace, scopeIds: [...scopes] };
          }
        } finally {
          stop();
          signal.removeEventListener('abort', onAbort);
        }
      })();
    },
  };
}
