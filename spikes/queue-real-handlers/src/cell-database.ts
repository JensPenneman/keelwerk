import pg from 'pg';
import type { PostgresUrls } from './postgres-urls.ts';

let counter = 0;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Runs `work` on an admin connection to `url` and closes it. */
export async function asAdmin<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** A database of its own on the one container: each cell starts from empty tables. */
export interface CellDatabase {
  readonly name: string;
  readonly urls: PostgresUrls;
  /** Drops it (forced); every connection of the cell is closed by then. */
  drop(): Promise<void>;
}

export async function createCellDatabase(container: PostgresUrls): Promise<CellDatabase> {
  counter += 1;
  const name = `cell_${process.pid}_${counter}`;
  await asAdmin(container.adminUrl, (client) => client.query(`create database ${name}`));
  return {
    name,
    urls: {
      adminUrl: withDatabase(container.adminUrl, name),
      appUrl: withDatabase(container.appUrl, name),
    },
    drop: async () => {
      await asAdmin(container.adminUrl, (client) =>
        client.query(`drop database ${name} with (force)`),
      );
    },
  };
}
