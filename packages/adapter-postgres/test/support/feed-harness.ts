import type { DataAdapter, PlacementConfig } from '@keelwerk/core';
import pg from 'pg';
import type { AccelerationOptions } from '../../src/acceleration-options.ts';
import { postgresAdapter } from '../../src/postgres-adapter.ts';
import { createTestDatabase } from './create-test-database.ts';
import { prepareNamespaces } from './prepare-namespaces.ts';
import { known } from './store-rows.ts';
import type { TestDatabase } from './test-database.ts';
import { testEnvironment } from './test-environment.ts';

/** What a feed test file works with. */
export interface FeedHarness {
  readonly database: TestDatabase;
  /** An adapter of the factory over the file's database; closed with the harness. */
  adapter(options?: AccelerationOptions): Promise<DataAdapter>;
  /** The notifications of `kw_events` seen so far, on a connection of the harness. */
  readonly notifications: string[];
  /** Resolves with the notifications once `count` have arrived, or rejects after `timeoutMs`. */
  arrived(count: number, timeoutMs: number): Promise<readonly string[]>;
  /** A connection of the database owner, for statements the application role may not run. */
  owner<T>(work: (client: pg.Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Creates the file's database with the framework tables and a listener on `kw_events`. */
export async function feedHarness(databaseName: string): Promise<FeedHarness> {
  const database = await createTestDatabase(databaseName);
  await prepareNamespaces(database.adminUrl);
  const adapters: DataAdapter[] = [];
  const notifications: string[] = [];
  const waiting: { count: number; resolve: () => void }[] = [];
  const listener = new pg.Client({ connectionString: database.adminUrl });
  await listener.connect();
  listener.on('notification', (message) => {
    notifications.push(message.payload ?? '');
    for (const entry of waiting) if (notifications.length >= entry.count) entry.resolve();
  });
  await listener.query('listen kw_events');
  const placement: PlacementConfig = {
    id: 'main',
    url: database.appUrl,
    strategy: 'shared-tables',
    pool: { max: 4 },
  };
  return {
    database,
    notifications,
    adapter: async (options = {}) => {
      const created = postgresAdapter({ entities: (ref) => known.get(ref), ...options }).create(
        placement,
        testEnvironment(),
      );
      await created.connect();
      adapters.push(created);
      return created;
    },
    arrived: async (count, timeoutMs) => {
      if (notifications.length < count) {
        await new Promise<void>((resolve, reject) => {
          const entry = { count, resolve };
          waiting.push(entry);
          setTimeout(() => {
            reject(new Error(`expected ${count} notifications, saw ${notifications.length}`));
          }, timeoutMs);
        });
      }
      return [...notifications];
    },
    owner: async (work) => {
      const client = new pg.Client({ connectionString: database.adminUrl });
      await client.connect();
      try {
        return await work(client);
      } finally {
        await client.end();
      }
    },
    close: async () => {
      await Promise.all(adapters.map(async (adapter) => adapter.close(5000)));
      await listener.end();
    },
  };
}
