import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { describe, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import {
  hooksStoredBytes,
  journalStoredBytes,
  relayStoredBytes,
  type StoredBytesOptions,
} from './support/stored-bytes-cases.ts';

/** A database of its own, so the counters of one case start at zero. */
async function postgresOptions(name: string): Promise<StoredBytesOptions> {
  const database = await createTestDatabase(name);
  return {
    adapter: 'memory',
    external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
  };
}

describe('core.eventBytes counts what is stored on PostgreSQL', () => {
  test(
    'the hooks app: decision records with request and prepare, effect records and attempts',
    {
      timeout: 180_000,
    },
    async () => hooksStoredBytes(await postgresOptions('stored_bytes_hooks')),
  );

  test(
    'the journal app: module stream records and an inline reaction that appends one',
    {
      timeout: 180_000,
    },
    async () => journalStoredBytes(await postgresOptions('stored_bytes_journal')),
  );

  test(
    'the relay app: inline and asynchronous reactions, the process stream',
    {
      timeout: 180_000,
    },
    async () => relayStoredBytes(await postgresOptions('stored_bytes_relay')),
  );
});
