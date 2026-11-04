import type { Logger, NamespaceRef } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { createPostgresChangeFeed } from './postgres-change-feed.ts';

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};
const namespace: NamespaceRef = { id: 'ns-app' } as NamespaceRef;

const feed = (notify: boolean): ReturnType<typeof createPostgresChangeFeed> =>
  createPostgresChangeFeed({
    url: 'postgres://nobody@127.0.0.1:1/none',
    applicationName: 'unit',
    log,
    notify,
    adapter: {
      unit: async () => {
        throw new Error('no database in this test');
      },
    },
  });

test('a wake with a signal that is already aborted ends at once, in both modes', async () => {
  for (const notify of [true, false]) {
    const stop = new AbortController();
    stop.abort();
    const wakes = feed(notify).source.wake([namespace], stop.signal)[Symbol.asyncIterator]();
    expect((await wakes.next()).done).toBe(true);
  }
});

test('a wake after close ends at once and opens no connection', async () => {
  const closed = feed(true);
  await closed.close(1000);
  const wakes = closed.source
    .wake([namespace], new AbortController().signal)
    [Symbol.asyncIterator]();
  expect((await wakes.next()).done).toBe(true);
});
