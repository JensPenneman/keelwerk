import type { NamespaceRef } from '@keelwerk/core';
import type { Client } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { pgSchemaConnection, postgresSchemaOperations } from '../src/index.ts';
import { connect } from './support/connect.ts';
import { createTestDatabase } from './support/create-test-database.ts';

const root = 'history_root';
const namespace: NamespaceRef = {
  id: 'ns-history',
  placementId: 'main',
  appId: 'history',
  tenantId: null,
  root,
};

let admin: Client;
let adminUrl = '';

beforeAll(async () => {
  const postgres = await createTestDatabase('history_read_only');
  adminUrl = postgres.adminUrl;
  admin = await connect(adminUrl);
  await admin.query(`create schema ${root}`);
  await admin.query(
    `create table ${root}.kw_migrations (track text, id text, checksum text, applied_at timestamptz, steps_applied int)`,
  );
});

afterAll(async () => {
  await admin?.end();
});

test('a write attempted inside the read of the migration history is refused by the database', async () => {
  const refusals: string[] = [];
  const schema = postgresSchemaOperations(
    pgSchemaConnection(async () => {
      const client = await connect(adminUrl);
      return {
        query: async (sql, parameters) => {
          if (sql.startsWith('select track')) {
            await client.query('create table history_write_probe (x int)').then(
              () => refusals.push('written'),
              (error: Error) => refusals.push(error.message),
            );
          }
          return client.query(sql, parameters);
        },
        end: () => client.end(),
      };
    }),
  );
  // The refused write aborts the transaction, so the read that follows it fails too.
  await expect(schema.history(namespace)).rejects.toThrow('current transaction is aborted');
  expect(refusals).toEqual(['cannot execute CREATE TABLE in a read-only transaction']);
});
