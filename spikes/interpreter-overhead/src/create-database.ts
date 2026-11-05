import pg from 'pg';
import type { PostgresDatabase } from './postgres-database.ts';
import type { PostgresUrls } from './postgres-urls.ts';

let counter = 0;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function asAdmin<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates an empty database on the one measurement container, with `pg_stat_statements` created in
 * it, over the admin URL, so each measured world starts from an empty log. Dropping it (forced,
 * in case a connection is still closing) is the caller's job at the world's stop.
 */
export async function createDatabase(urls: PostgresUrls): Promise<PostgresDatabase> {
  counter += 1;
  const name = `bench_${process.pid}_${counter}`;
  await asAdmin(urls.adminUrl, (client) => client.query(`create database ${name}`));
  const database: PostgresUrls = {
    adminUrl: withDatabase(urls.adminUrl, name),
    appUrl: withDatabase(urls.appUrl, name),
  };
  await asAdmin(database.adminUrl, (client) =>
    client.query('create extension if not exists pg_stat_statements'),
  );
  return {
    name,
    urls: database,
    drop: () =>
      asAdmin(urls.adminUrl, (client) => client.query(`drop database ${name} with (force)`)).then(
        () => undefined,
      ),
  };
}
