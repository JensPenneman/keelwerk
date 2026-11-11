import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { describe, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { bootReactions } from './support/reactions-kit.ts';
import { runSliceThree } from './support/slice-three.ts';

describe('SLICE M2-3 on PostgreSQL', () => {
  test('reactions retry per tenant and never delay another tenant', {
    timeout: 120_000,
  }, async () => {
    const database = await createTestDatabase('slice_three');
    const kit = await bootReactions({
      watched: true,
      external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
    });
    try {
      await runSliceThree(kit);
    } finally {
      await kit.stop();
    }
  });
});
