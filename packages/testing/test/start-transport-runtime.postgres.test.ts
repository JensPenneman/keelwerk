import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { httpHost } from '@keelwerk/transport-http';
import { rest } from '@keelwerk/transport-rest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { dueAt } from '../src/conformance/transport/due-at.ts';
import { startTransportRuntime } from '../src/conformance/transport/start-transport-runtime.ts';
import type { TransportRuntime } from '../src/conformance/transport/transport-runtime.ts';
import { library, loans } from '../src/fixtures/index.ts';
import { testPrincipalHeader } from '../src/harness/test-principal-header.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import type { TestDatabase } from './support/test-database.ts';

const app = defineApp({ id: 'external', modules: [live, library, loans, rest] });

describe('a transport runtime on an external PostgreSQL', () => {
  let urls: TestDatabase;
  let started: TransportRuntime;

  beforeAll(async () => {
    urls = await createTestDatabase('transport_external');
    started = await startTransportRuntime({
      app,
      host: httpHost(),
      external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    });
  });
  afterAll(() => started?.stop());

  test('stores the loan a request wrote in that database', async () => {
    const answer = await started.fetch(
      new Request('https://external.example.test/api/loans/lend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant': started.tenants.acme ?? '',
          [testPrincipalHeader]: JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
        },
        body: JSON.stringify({ bookTitle: 'Dune', dueAt }),
      }),
    );
    expect(answer.status).toBe(200);
    const owner = new pg.Client({ connectionString: urls.adminUrl });
    await owner.connect();
    try {
      const tables = await owner.query(
        "select schemaname, tablename from pg_tables where schemaname not in ('pg_catalog', 'information_schema')",
      );
      const rows: string[] = [];
      for (const { schemaname, tablename } of tables.rows) {
        const found = await owner.query(
          `select t::text as row from "${schemaname}"."${tablename}" t`,
        );
        rows.push(...found.rows.map((row) => row.row));
      }
      expect(rows.some((row) => row.includes('Dune'))).toBe(true);
    } finally {
      await owner.end();
    }
  });
});
