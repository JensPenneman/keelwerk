import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { describe, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { admissionAtTheLimit, admissionOverTheLimits } from './support/prepare-admission-cases.ts';
import type { StoredBytesOptions } from './support/stored-bytes-cases.ts';

/** A database of its own, so the counters of one case start at zero. */
async function postgresOptions(name: string): Promise<StoredBytesOptions> {
  const database = await createTestDatabase(name);
  return {
    adapter: 'memory',
    external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
  };
}

describe('a command with prepare over its limits on PostgreSQL', () => {
  test(
    'is refused before prepare runs, and a resend is answered from its receipt',
    {
      timeout: 180_000,
    },
    async () => admissionOverTheLimits(await postgresOptions('prepare_admission_over')),
  );

  test(
    'that crosses the limit performs once and the next is refused before prepare',
    {
      timeout: 180_000,
    },
    async () => admissionAtTheLimit(await postgresOptions('prepare_admission_at')),
  );
});
