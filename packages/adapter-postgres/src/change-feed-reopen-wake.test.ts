import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Logger, NamespaceRef } from '@keelwerk/core';
import { expect, test, vi } from 'vitest';
import type { ListenConnectionSettings } from './listen-connection.ts';
import { createPostgresChangeFeed } from './postgres-change-feed.ts';

/** The settings of every session the feed opened, by channel. */
const sessions = vi.hoisted(() => new Map<string, unknown>());
/** Settled when the feed opened the session of the workers (channel `kw_jobs`). */
const jobsOpened = vi.hoisted(() => Promise.withResolvers<void>());

vi.mock('./listen-connection.ts', () => ({
  openListenConnection: (settings: ListenConnectionSettings) => {
    sessions.set(settings.channel ?? 'kw_events', settings);
    if (settings.channel === 'kw_jobs') jobsOpened.resolve();
    return Promise.resolve({ close: async () => undefined });
  },
}));

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};
const namespace: NamespaceRef = { id: 'ns-app' } as NamespaceRef;

test('a session of the workers that listens again wakes every reader for every queue, and nothing else does', async () => {
  const feed = createPostgresChangeFeed({
    url: 'postgres://nobody@127.0.0.1:1/none',
    applicationName: 'reopen-wake',
    log,
    notify: true,
    adapter: {
      unit: async () => {
        throw new Error('no database in this test');
      },
    },
  });
  const stop = new AbortController();
  const wakes = feed.source.jobs([namespace], stop.signal)[Symbol.asyncIterator]();
  try {
    // A reader starts with one wake that names no queue.
    expect(await wakes.next()).toEqual({ done: false, value: { namespace: 'ns-app' } });
    await jobsOpened.promise;
    const session = sessions.get('kw_jobs') as ListenConnectionSettings;
    const next = wakes.next();
    // The loss of the session wakes nobody: a wake is pushed and delivered in microtasks, so one
    // turn of the event loop is enough to have seen it.
    session.onLost?.(new Error('the connection ended'));
    const quiet = await Promise.race([next.then(() => 'a wake'), nextTurn('no wake')]);
    expect(quiet).toBe('no wake');
    // The session listens again: every reader is woken for every queue.
    session.onListening?.();
    expect(await next).toEqual({ done: false, value: { namespace: 'ns-app' } });
  } finally {
    stop.abort();
    await feed.close(1000);
  }
});
