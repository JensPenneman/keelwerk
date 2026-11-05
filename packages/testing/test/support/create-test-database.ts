import pg from 'pg';
import { inject } from 'vitest';
import type { TestDatabase } from './test-database.ts';

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Creates an empty database on the shared cluster, so each suite owns its tables and rows. */
export async function createTestDatabase(name: string): Promise<TestDatabase> {
  const cluster = inject('postgresCluster');
  const admin = new pg.Client({ connectionString: cluster.adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  return {
    adminUrl: withDatabase(cluster.adminUrl, name),
    appUrl: withDatabase(cluster.appUrl, name),
    version: cluster.version,
  };
}
