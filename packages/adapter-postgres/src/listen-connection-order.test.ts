import { EventEmitter } from 'node:events';
import type { Logger } from '@keelwerk/core';
import { expect, test, vi } from 'vitest';
import type { PostgresClientSettings } from './connections/create-postgres-client.ts';
import { openListenConnection } from './listen-connection.ts';

/** The statements the session sent, in order, and the answers the test holds back. */
const sent: string[] = [];
const held = Promise.withResolvers<void>();
/** Settled when the session has sent its LISTEN. */
const asked = Promise.withResolvers<void>();

vi.mock('./connections/create-postgres-client.ts', () => ({
  createPostgresClient: (settings: PostgresClientSettings) => {
    const client = Object.assign(new EventEmitter(), {
      connect: async () => undefined,
      // The `LISTEN` is answered when the test says so.
      query: async (text: string) => {
        sent.push(text);
        asked.resolve();
        await held.promise;
      },
      end: async () => undefined,
    });
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

test('a session says it is listening only after its LISTEN has been answered, never before', async () => {
  const events: string[] = [];
  const opening = openListenConnection({
    url: 'postgres://user:secret@127.0.0.1:1/db',
    applicationName: 'order-test',
    channel: 'kw_jobs',
    log,
    onNotification: () => undefined,
    onListening: () => {
      events.push('onListening');
    },
  });
  // The session sent its LISTEN and waits for the answer, which this test holds back. A session
  // that said it was listening before it sent the statement, or in the turn that sends it, has
  // said so by now.
  await asked.promise;
  expect(sent).toEqual(['listen kw_jobs']);
  expect(events).toEqual([]);
  held.resolve();
  const connection = await opening;
  expect(events).toEqual(['onListening']);
  await connection.close();
});
