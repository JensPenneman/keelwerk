import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { describe } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { processStateCacheCases } from './support/process-state-cache-cases.ts';

describe('the process state cache on PostgreSQL', () => {
  processStateCacheCases({
    external: async () => {
      const database = await createTestDatabase('process_state_cache');
      return {
        factory: postgresAdapter({ ownerUrl: database.adminUrl }),
        url: database.appUrl,
        adminUrl: database.adminUrl,
      };
    },
  });
});
