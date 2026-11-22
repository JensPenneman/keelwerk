import { EventEmitter } from 'node:events';
import type { Logger } from '@keelwerk/core';
import { expect, onTestFinished, test, vi } from 'vitest';
import type { PostgresClientSettings } from './connections/create-postgres-client.ts';
import { openListenConnection } from './listen-connection.ts';

/** What each client the session creates does, in order: `connect` fails, or the session listens. */
const script: ('refused' | 'listens')[] = [];
const created: { emit(event: string, error: Error): void }[] = [];

vi.mock('./connections/create-postgres-client.ts', () => ({
  createPostgresClient: (settings: PostgresClientSettings) => {
    const outcome = script.shift() ?? 'listens';
    const client = Object.assign(new EventEmitter(), {
      connect: async () => {
        if (outcome === 'refused') throw new Error('connection refused');
      },
      query: async () => undefined,
      end: async () => undefined,
    });
    created.push(client);
    client.on('error', settings.onError);
    return client;
  },
}));

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

test('a successful LISTEN starts the count again: the next loss waits the first pause, not the second', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  script.push('refused', 'listens', 'listens');
  created.length = 0;
  const connection = await openListenConnection({
    url: 'postgres://user:secret@127.0.0.1:1/db',
    applicationName: 'reset-test',
    log,
    random: () => 0.5,
    onNotification: () => undefined,
  });
  onTestFinished(async () => {
    await connection.close();
  });
  // The first client was refused: one failure, so the pause before the second is one second.
  expect(created).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(created).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(created).toHaveLength(2);
  // The second client listens. The server then ends it: a second loss, but the first since a
  // LISTEN.
  created[1]?.emit('error', new Error('terminating connection due to administrator command'));
  await vi.advanceTimersByTimeAsync(999);
  expect(created).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(created).toHaveLength(3);
});
