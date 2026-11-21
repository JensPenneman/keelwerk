import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createKey, keyOwner } from './support/api-key-calls.ts';
import { type BootedApiKeys, bootApiKeys } from './support/boot-api-keys.ts';

describe('api-keys on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let app: BootedApiKeys;

  beforeAll(async () => {
    postgres = await startPostgres();
    app = await bootApiKeys('memory', {
      external: { factory: postgresAdapter({ ownerUrl: postgres.adminUrl }), url: postgres.appUrl },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.runtime.stop();
    await postgres?.stop();
  });

  test('on PostgreSQL the migration applies and a key is created, accepted and revoked', async () => {
    const { key, id } = await createKey(app, { scopes: ['write'] });
    const read = await app.withKey(key, 'library.book.query', {});
    expect(read.ok).toBe(true);
    const revoked = await app.as(keyOwner).attempt('api-keys.key.revoke', { id });
    expect(revoked.ok).toBe(true);
    const refused = await app.withKey(key, 'library.book.query', {});
    expect(refused.ok ? undefined : refused.error.kind).toBe('unauthenticated');
    expect((await app.row(id))?.revokedAt).toBeDefined();
  });
});
