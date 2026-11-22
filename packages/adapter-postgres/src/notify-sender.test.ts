import { EventEmitter } from 'node:events';
import type { Logger } from '@keelwerk/core';
import { expect, test, vi } from 'vitest';
import type { PostgresClientSettings } from './connections/create-postgres-client.ts';
import { notifySender } from './notify-sender.ts';

/** A connection the test holds: it settles its connect and its query when the test says so. */
interface FakeClient {
  readonly settings: PostgresClientSettings;
  readonly connecting: PromiseWithResolvers<void>;
  readonly querying: PromiseWithResolvers<void>;
  /** Settled when the sender sent its statement. */
  readonly queried: PromiseWithResolvers<void>;
  ended: number;
}

/** Every client the sender created, in order. */
const clients = vi.hoisted((): FakeClient[] => []);

vi.mock('./connections/create-postgres-client.ts', () => ({
  createPostgresClient: (settings: PostgresClientSettings) => {
    const fake: FakeClient = {
      settings,
      connecting: Promise.withResolvers<void>(),
      querying: Promise.withResolvers<void>(),
      queried: Promise.withResolvers<void>(),
      ended: 0,
    };
    clients.push(fake);
    const client = Object.assign(new EventEmitter(), {
      connect: () => fake.connecting.promise,
      query: () => {
        fake.queried.resolve();
        return fake.querying.promise;
      },
      end: async () => {
        fake.ended += 1;
      },
    });
    client.on('error', settings.onError);
    return client;
  },
}));

const warnings: string[] = [];
const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (message) => {
    warnings.push(message);
  },
  error: () => undefined,
  child: () => log,
};

test('a late error of the connection a failed send dropped leaves the connection that is opening, and close ends it', async () => {
  const sender = notifySender({
    url: 'postgres://nobody@127.0.0.1:1/none',
    applicationName: 'x',
    log,
  });
  // The first send opens a connection, and its statement fails: the connection is dropped and
  // ended.
  const failing = sender.send('first');
  const failed = failing.catch((error: unknown) => error);
  const [first] = clients;
  if (first === undefined) throw new Error('the sender opened no connection');
  first.connecting.resolve();
  await first.queried.promise;
  first.querying.reject(new Error('the statement failed'));
  expect(await failed).toEqual(new Error('the statement failed'));
  expect(first.ended).toBe(1);
  // The next send opens another connection, which is still connecting.
  const next = sender.send('second');
  expect(clients).toHaveLength(2);
  const second = clients[1];
  if (second === undefined) throw new Error('the sender opened no second connection');
  // The driver reports the end of the first connection after all: the sender holds a newer one now.
  first.settings.onError(new Error('the first connection ended'));
  second.connecting.resolve();
  second.querying.resolve();
  await next;
  await sender.close();
  // The newer connection was not forgotten by the late error, so the close ends it.
  expect(second.ended).toBe(1);
  // And the late error is not reported as the failure of a connection that is held.
  expect(warnings).toEqual([]);
});
