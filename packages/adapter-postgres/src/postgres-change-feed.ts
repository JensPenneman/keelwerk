import { setTimeout as delay } from 'node:timers/promises';
import type { ChangeFeedSource, DataAdapter, Logger, NamespaceRef, Position } from '@keelwerk/core';
import { pollChangeFeed } from '@keelwerk/data';
import type { ListenConnection } from './listen-connection.ts';
import { openListenConnection } from './listen-connection.ts';
import type { Notifier } from './notifier.ts';
import { createNotifier } from './notifier.ts';
import { notifySender } from './notify-sender.ts';
import { pollHeads } from './poll-heads.ts';
import { withinDeadline } from './within-deadline.ts';

type Wake = { readonly namespace: string; readonly scopeIds: readonly string[] };

const pageSize = 1000;

/** What `createPostgresChangeFeed` needs. */
export interface PostgresChangeFeedSettings {
  readonly url: string;
  readonly applicationName: string;
  readonly log: Logger;
  /** The adapter's units, for the polling of the heads. */
  readonly adapter: Pick<DataAdapter, 'unit'>;
  /** `false`: poll only, no notifier and no `LISTEN` connection. */
  readonly notify: boolean;
  /** Milliseconds between two polls of the heads; default 1000 (14.3.7). */
  readonly pollIntervalMs?: number;
  /** Milliseconds a new connection may take to open; default 10000 (the placement's `connectionTimeoutMs`). */
  readonly connectionTimeoutMs?: number;
}

/** The feed the adapter serves, the hook units call after commit, and the end of its connections. */
export interface PostgresChangeFeed {
  readonly source: ChangeFeedSource;
  /** A unit appended events in this scope; sends nothing when `notify` is off. */
  committed(namespace: string, scopeId: string): void;
  /** Ends the readers and both connections; gives up waiting on them after `deadlineMs`. */
  close(deadlineMs: number): Promise<void>;
}

/**
 * The change feed of the PostgreSQL adapter (14.3.7, 15.2.5). Wake-ups come from `NOTIFY kw_events`
 * on one shared `LISTEN` connection, sent by the coalescing notifier after commit, and from polling
 * the heads every second, so a notification that is lost costs one interval of latency and never
 * an event. A namespace-wide payload (`<namespace>:*`) wakes with every scope that has events. A
 * wake-up may repeat: the poll reports a scope the notification already named.
 */
export function createPostgresChangeFeed(settings: PostgresChangeFeedSettings): PostgresChangeFeed {
  const moved = pollHeads(settings.adapter);
  const polling = pollChangeFeed({
    moved,
    sleep: async (ms, signal) => {
      await delay(ms, undefined, { signal }).catch(() => undefined);
    },
    intervalMs: settings.pollIntervalMs ?? 1000,
    pageSize,
    onError: (namespace, error) => {
      settings.log.warn('postgres feed: polling the heads failed', {
        namespace: namespace.id,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const listeners = new Set<(payload: string) => void>();
  let listening: Promise<ListenConnection> | undefined;
  let notifier: Notifier | undefined;
  let sender: ReturnType<typeof notifySender> | undefined;
  let closed = false;
  const closing = new AbortController();

  const listen = async (): Promise<void> => {
    if (closed) return;
    listening ??= openListenConnection({
      url: settings.url,
      applicationName: settings.applicationName,
      connectionTimeoutMs: settings.connectionTimeoutMs ?? 10_000,
      log: settings.log,
      onNotification: (payload) => {
        for (const listener of listeners) listener(payload);
      },
    });
    await listening;
  };

  const everyScope = async (namespace: NamespaceRef): Promise<readonly string[]> => {
    const marks = new Map<string, Position>();
    for (;;) {
      const page = await moved(namespace, marks, pageSize);
      for (const entry of page) marks.set(entry.scopeId, entry.head);
      if (page.length < pageSize) return [...marks.keys()];
    }
  };

  const source: ChangeFeedSource = {
    level: settings.notify ? 'notify' : 'poll',
    async *wake(namespaces: readonly NamespaceRef[], caller: AbortSignal): AsyncGenerator<Wake> {
      const signal = AbortSignal.any([caller, closing.signal]);
      if (signal.aborted) return;
      if (!settings.notify) {
        yield* polling.wake(namespaces, signal);
        return;
      }
      const inner = new AbortController();
      const stop = (): void => inner.abort();
      signal.addEventListener('abort', stop, { once: true });
      const pending = new Map<string, Set<string>>();
      let wakeUp: (() => void) | undefined;
      const add = (namespace: string, scopeIds: readonly string[]): void => {
        const known = pending.get(namespace) ?? new Set<string>();
        for (const id of scopeIds) known.add(id);
        pending.set(namespace, known);
        wakeUp?.();
      };
      const byId = new Map(namespaces.map((namespace) => [namespace.id, namespace]));
      const listener = (payload: string): void => {
        const cut = payload.lastIndexOf(':');
        if (cut < 0) return;
        const namespace = byId.get(payload.slice(0, cut));
        if (namespace === undefined) return;
        const rest = payload.slice(cut + 1);
        if (rest !== '*') {
          add(
            namespace.id,
            rest.split(',').filter((id) => id !== ''),
          );
          return;
        }
        everyScope(namespace).then(
          (ids) => {
            add(namespace.id, ids);
          },
          (error: unknown) => {
            settings.log.warn('postgres feed: a namespace-wide wake-up could not list the scopes', {
              message: error instanceof Error ? error.message : String(error),
            });
          },
        );
      };
      let pump: Promise<void> | undefined;
      try {
        if (inner.signal.aborted) return;
        listeners.add(listener);
        pump = (async () => {
          for await (const wake of polling.wake(namespaces, inner.signal)) {
            add(wake.namespace, wake.scopeIds);
          }
        })().catch((error: unknown) => {
          settings.log.warn('postgres feed: polling stopped', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
        listen().catch((error: unknown) => {
          settings.log.warn('postgres feed: the listen connection could not be opened', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
        while (!inner.signal.aborted) {
          if (pending.size === 0) {
            await new Promise<void>((resolve) => {
              const done = (): void => {
                inner.signal.removeEventListener('abort', done);
                wakeUp = undefined;
                resolve();
              };
              wakeUp = done;
              inner.signal.addEventListener('abort', done, { once: true });
            });
            continue;
          }
          const batch = [...pending];
          pending.clear();
          for (const [namespace, scopeIds] of batch) yield { namespace, scopeIds: [...scopeIds] };
        }
      } finally {
        inner.abort();
        listeners.delete(listener);
        signal.removeEventListener('abort', stop);
        await pump;
      }
    },
  };

  return {
    source,
    committed: (namespace, scopeId) => {
      if (!settings.notify || closed) return;
      if (notifier === undefined) {
        sender = notifySender(settings);
        const active = sender;
        notifier = createNotifier({
          send: active.send,
          onError: (error) => {
            settings.log.warn('postgres notifier: a wake-up was not sent', {
              message: error instanceof Error ? error.message : String(error),
            });
          },
        });
      }
      notifier.committed(namespace, scopeId);
    },
    close: async (deadlineMs) => {
      closed = true;
      closing.abort();
      const endsAt = Date.now() + deadlineMs;
      const left = (): number => endsAt - Date.now();
      const stopped = notifier?.stop();
      if (stopped !== undefined && (await withinDeadline(stopped, left()))) {
        settings.log.warn('postgres feed: the notifier did not stop before its deadline');
      }
      const open = listening;
      listening = undefined;
      const ended = Promise.all([
        sender?.close(),
        open?.then(
          (connection) => connection.close(),
          () => undefined,
        ),
      ]);
      if (await withinDeadline(ended, left())) {
        settings.log.warn('postgres feed: the connections did not end before the deadline');
      }
    },
  };
}
